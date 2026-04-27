const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

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

async function sendTelegram(chatId, message) {
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
  });
}

function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart.toISOString().split('T')[0];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });

  // JWT 검증
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`
      }
    });
    const userData = await verifyRes.json();
    if (!userData?.id || userData.id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } catch(e) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { condition, injury_part, injury_level, memo, today_plan, target_pace, phase } = req.body;

  // 현재 주간 계획 가져오기
  const weekStart = getWeekStart();
  const plans = await sbGet('weekly_plans', `user_id=eq.${userId}&week_start=eq.${weekStart}`);
  const plan = plans?.[0];

  // 프로필 (텔레그램용)
  const profiles = await sbGet('profiles', `id=eq.${userId}&select=telegram_chat_id`);
  const chatId = profiles?.[0]?.telegram_chat_id;

  const days = ['mon','tue','wed','thu','fri','sat','sun'];
  const dayNames = ['월','화','수','목','금','토','일'];
  const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

  // 현재 주간 계획 요약
  const weekPlanSummary = plan
    ? days.map((d, i) => `${dayNames[i]}: ${plan[d] || '-'}`).join(', ')
    : '계획 없음';

  const prompt = `마라톤 코치로서 선수의 컨디션에 맞게 오늘 훈련과 이번 주 계획을 조정해주세요.

선수 정보:
- 목표 페이스: ${target_pace}/km
- 훈련 단계: ${phase}
- 오늘(${dayNames[todayIdx]}요일) 계획: ${today_plan}
- 이번 주 계획: ${weekPlanSummary}

오늘 컨디션:
- 상태: ${condition}
- 부상: ${injury_part === '없음' ? '없음' : `${injury_part} (${injury_level})`}
${memo ? `- 메모: ${memo}` : ''}

아래 JSON 형식으로만 응답하세요:
{
  "coaching": "오늘 코칭 메시지 (200자 이내)",
  "weekly_adjustment": {
    "mon": "훈련종류 또는 휴식",
    "tue": "훈련종류 또는 휴식",
    "wed": "훈련종류 또는 휴식",
    "thu": "훈련종류 또는 휴식",
    "fri": "휴식",
    "sat": "훈련종류 또는 휴식",
    "sun": "훈련종류 또는 휴식"
  },
  "adjustment_reason": "주간 계획 조정 이유 (100자 이내)",
  "changed": true
}

규칙:
- 부상(심각): 이번 주 모두 휴식 또는 수영만
- 부상(중간): 강도 높은 훈련 → 수영/자전거/이지런으로 대체
- 부상(경미): 해당 부위 부담 없는 훈련으로 조정
- 피로: 강도 낮추기, 인터벌/템포 → 이지런으로
- 좋음: 계획 유지 (changed: false)
- 훈련 종류: 인터벌/템포런/페이스주/롱런/LSD/이지런/수영/자전거/휴식`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await claudeRes.json();
    const text = data.content?.[0]?.text || '{}';
    const result = JSON.parse(text.replace(/```json|```/g, '').trim());

    // 주간 계획 업데이트
    if (result.changed && result.weekly_adjustment && plan) {
      await sbPatch('weekly_plans',
        `user_id=eq.${userId}&week_start=eq.${weekStart}`,
        result.weekly_adjustment
      );

      // 텔레그램 알림
      const conditionEmoji = condition === '좋음' ? '⚡' : condition === '피로' ? '😴' : '😊';
      const injuryText = injury_part !== '없음' ? `\n🚨 ${injury_part} 부상(${injury_level})` : '';
      await sendTelegram(chatId,
        `${conditionEmoji} <b>컨디션 반영 - 주간 계획 조정</b>${injuryText}\n─────────\n${result.coaching}\n\n📅 <b>이번 주 조정된 계획</b>\n${result.adjustment_reason}`
      );
    }

    res.json({
      success: true,
      coaching: result.coaching || '코칭을 불러올 수 없습니다.',
      weekly_adjustment: result.weekly_adjustment,
      adjustment_reason: result.adjustment_reason,
      changed: result.changed
    });

  } catch(e) {
    console.error('Coaching error:', e);
    res.status(500).json({ error: e.message });
  }
}
