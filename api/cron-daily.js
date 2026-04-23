// 매일 오전 6시 자동 실행
// 어제 훈련 계획 vs 실제 비교 → 미완료 훈련 재배치 → 앱 푸시 알림

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

async function sbGet(table, filter) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
}

async function sbPatch(table, filter, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal'
    },
    body: JSON.stringify(data)
  });
}

// ── VAPID 서명 생성 ──
async function generateVapidHeaders(endpoint) {
  const audience = new URL(endpoint).origin;
  const expiration = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: expiration,
    sub: 'mailto:admin@runai-coach.vercel.app'
  };

  const b64url = (str) => btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  // VAPID 개인키로 서명
  const keyData = Uint8Array.from(atob(VAPID_PRIVATE_KEY.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  const signatureB64 = b64url(String.fromCharCode(...new Uint8Array(signature)));
  const jwt = `${signingInput}.${signatureB64}`;

  return {
    Authorization: `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
    'Content-Type': 'application/json',
    TTL: '86400'
  };
}

// ── 푸시 알림 전송 ──
async function sendPush(subscription, title, body, tag = 'training') {
  try {
    const endpoint = subscription.endpoint;
    const headers = await generateVapidHeaders(endpoint);
    const payload = JSON.stringify({ title, body, tag, url: '/' });

    // 암호화 없이 전송 (평문 - 간단 구현)
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: payload
    });
    return res.ok;
  } catch(e) {
    console.error('Push send error:', e);
    return false;
  }
}

// ── 요일 인덱스 → DB 컬럼 ──
function dayToCol(dayIdx) {
  return ['sun','mon','tue','wed','thu','fri','sat'][dayIdx];
}
function dayToName(dayIdx) {
  return ['일','월','화','수','목','금','토'][dayIdx];
}

// ── Claude API 호출 ──
async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// ── 메인 핸들러 ──
export default async function handler(req, res) {
  // Vercel Cron 인증
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const today = new Date();
  const todayIdx = today.getDay(); // 0=일, 1=월...
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayIdx = yesterday.getDay();

  // 주간 시작일 (월요일)
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - (todayIdx === 0 ? 6 : todayIdx - 1));
  weekStart.setHours(0, 0, 0, 0);
  const weekStartStr = weekStart.toISOString().split('T')[0];

  try {
    // 푸시 구독이 있는 사용자 전체 조회
    const subscriptions = await sbGet('push_subscriptions', 'select=user_id,subscription');
    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
      return res.json({ message: 'No push subscribers' });
    }

    const results = [];

    for (const sub of subscriptions) {
      try {
        const userId = sub.user_id;
        const subscription = sub.subscription;

        // 이번 주 계획 조회
        const plans = await sbGet('weekly_plans', `user_id=eq.${userId}&week_start=eq.${weekStartStr}`);
        const plan = plans?.[0];
        if (!plan) continue;

        // 어제 계획된 훈련
        const yesterdayPlan = plan[dayToCol(yesterdayIdx)];
        if (!yesterdayPlan || yesterdayPlan === '휴식' || yesterdayPlan === '-') continue;

        // 어제 실제 운동 조회
        const yesterdayStart = yesterday.toISOString().split('T')[0];
        const yesterdayEnd = today.toISOString().split('T')[0];
        const acts = await sbGet('activities',
          `user_id=eq.${userId}&start_date=gte.${yesterdayStart}T00:00:00&start_date=lt.${yesterdayEnd}T00:00:00&select=workout_type,distance`
        );

        // 어제 실제로 운동했는지 확인
        const didExercise = Array.isArray(acts) && acts.length > 0;
        const didPlannedWorkout = didExercise && acts.some(a =>
          a.workout_type === yesterdayPlan ||
          (yesterdayPlan === '이지런' && a.distance > 3000) ||
          (yesterdayPlan === 'LSD' && a.distance > 15000)
        );

        if (didPlannedWorkout) continue; // 계획대로 했으면 스킵

        // 미완료! 남은 날 중 재배치할 날 찾기
        const remainingDays = [];
        for (let i = todayIdx; i <= 6; i++) {
          const col = dayToCol(i);
          const existing = plan[col];
          if (!existing || existing === '-' || existing === '휴식') {
            remainingDays.push(i);
          }
        }

        if (remainingDays.length === 0) {
          // 남은 날 없으면 그냥 알림만
          await sendPush(
            subscription,
            '🏃 BaBa School',
            `${dayToName(yesterdayIdx)}요일 ${yesterdayPlan} 훈련이 미완료예요. 이번 주 내 보충해보세요!`,
            'reschedule'
          );
          continue;
        }

        // Claude로 최적 재배치 날 결정
        const prompt = `마라톤 코치로서 훈련 재배치를 결정하세요.

미완료 훈련: ${yesterdayPlan}
오늘(${dayToName(todayIdx)}요일)부터 재배치 가능한 날: ${remainingDays.map(d => dayToName(d) + '요일').join(', ')}
이번 주 나머지 계획: ${remainingDays.map(d => `${dayToName(d)}:${plan[dayToCol(d)]||'비어있음'}`).join(', ')}

가장 적합한 날 1개만 선택해서 아래 형식으로만 답하세요:
{"day": ${remainingDays[0]}, "reason": "이유 한줄"}`;

        let bestDay = remainingDays[0];
        let reason = '가장 빠른 가능일';

        try {
          const result = await callClaude(prompt);
          const parsed = JSON.parse(result.replace(/```json|```/g, '').trim());
          if (parsed.day && remainingDays.includes(parsed.day)) {
            bestDay = parsed.day;
            reason = parsed.reason;
          }
        } catch(e) {}

        // 계획 업데이트
        const updateData = {};
        updateData[dayToCol(bestDay)] = yesterdayPlan;
        await sbPatch('weekly_plans', `user_id=eq.${userId}&week_start=eq.${weekStartStr}`, updateData);

        // 푸시 알림 전송
        const sent = await sendPush(
          subscription,
          '📅 훈련 재배치',
          `${dayToName(yesterdayIdx)}요일 ${yesterdayPlan}이 미완료예요.\n${dayToName(bestDay)}요일로 재배치했어요.`,
          'reschedule'
        );

        results.push({
          userId,
          missed: yesterdayPlan,
          rescheduled: dayToName(bestDay),
          reason,
          notified: sent
        });

      } catch(e) {
        console.error('User processing error:', e);
      }
    }

    res.json({ success: true, processed: subscriptions.length, rescheduled: results.length, results });

  } catch(error) {
    console.error('Daily cron error:', error);
    res.status(500).json({ error: error.message });
  }
}
