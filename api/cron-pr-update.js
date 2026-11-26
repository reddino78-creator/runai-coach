// PR 자동 갱신 — 매주 월요일 실행
// 최근 1년 Strava 활동에서 풀/하프/10K/5K 최고 기록 추출
// 기존 PR보다 빠르면 goals 테이블 업데이트 + 텔레그램 알림

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── 헬퍼 ──
function timeToSec(t) {
  if (!t || t === '-') return Infinity;
  const parts = t.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Infinity;
}

function secToTime(s) {
  if (!s || s === Infinity) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
}

async function sbPatch(table, filter, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(data)
  });
}

async function sendTelegram(chatId, msg) {
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' })
  });
}

// ── 거리별 최고 기록 추출 ──
// 각 거리 구간에 맞는 활동 중 가장 빠른 페이스(= 가장 짧은 시간) 추출
function extractBestTimes(activities) {
  const runTypes = ['Run', 'VirtualRun', 'TrailRun', '러닝', '트레일런'];
  const runs = activities.filter(a => {
    const t = a.sport_type || a.type || '';
    return runTypes.some(r => t.includes(r));
  });

  // 거리 범위 정의 (미터)
  const ranges = {
    pr_full:  { min: 41000, max: 44000 },  // 풀마라톤
    pr_half:  { min: 20000, max: 23000 },  // 하프마라톤
    pr_10k:   { min:  9000, max: 11500 },  // 10K
    pr_5k:    { min:  4500, max:  6000 },  // 5K
  };

  const best = {};
  for (const [key, range] of Object.entries(ranges)) {
    const matched = runs.filter(a => a.distance >= range.min && a.distance <= range.max);
    if (matched.length === 0) continue;

    // 완주 시간 기준 최고 기록 (moving_time 최소값)
    const fastest = matched.reduce((prev, cur) =>
      cur.moving_time < prev.moving_time ? cur : prev
    );
    best[key] = {
      timeSec: fastest.moving_time,
      timeStr: secToTime(fastest.moving_time),
      date: fastest.start_date,
      name: fastest.name
    };
  }
  return best;
}

// ── 사용자별 PR 갱신 ──
async function updatePRForUser(userId) {
  // 최근 1년 활동 가져오기
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const activities = await sbGet(
    `activities?user_id=eq.${userId}&start_date=gte.${oneYearAgo}&select=sport_type,type,distance,moving_time,start_date,name&order=start_date.desc&limit=500`
  );

  if (!Array.isArray(activities) || activities.length === 0) return null;

  // 현재 PR 가져오기
  const goals = await sbGet(
    `goals?user_id=eq.${userId}&select=id,pr_full,pr_half,pr_10k,pr_5k,telegram_chat_id&order=created_at.desc&limit=1`
  );
  const goal = Array.isArray(goals) && goals[0];
  if (!goal) return null;

  // Strava 1년 데이터에서 최고 기록 추출
  const bestTimes = extractBestTimes(activities);

  // 현재 PR과 비교해서 갱신 항목 찾기
  const updates = {};
  const improved = [];

  const labels = {
    pr_full: '풀마라톤',
    pr_half: '하프마라톤',
    pr_10k:  '10K',
    pr_5k:   '5K'
  };

  for (const [key, best] of Object.entries(bestTimes)) {
    const currentSec = timeToSec(goal[key]);
    if (best.timeSec < currentSec) {
      updates[key] = best.timeStr;
      improved.push({
        label: labels[key],
        old: goal[key] || '-',
        new: best.timeStr,
        date: best.date?.slice(0, 10),
        activity: best.name
      });
    }
  }

  if (Object.keys(updates).length === 0) return { userId, improved: [] };

  // goals 테이블 업데이트
  await sbPatch('goals', `user_id=eq.${userId}`, updates);

  // 텔레그램 알림
  const profile = await sbGet(
    `profiles?id=eq.${userId}&select=telegram_chat_id&limit=1`
  );
  const chatId = Array.isArray(profile) && profile[0]?.telegram_chat_id;

  if (chatId && improved.length > 0) {
    const lines = improved.map(i =>
      `🏅 <b>${i.label}</b>: ${i.old} → <b>${i.new}</b>\n   📅 ${i.date} · ${i.activity}`
    ).join('\n\n');

    await sendTelegram(chatId,
      `🎉 <b>개인 최고 기록(PB) 자동 갱신!</b>\n\n` +
      `Strava 최근 1년 기록을 분석한 결과,\n새로운 PB가 발견됐어요!\n\n` +
      `${lines}\n\n` +
      `🔗 BaBa School에서 확인하세요`
    );
  }

  return { userId, improved };
}

// ── 메인 핸들러 ──
export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Strava 연동된 모든 사용자
    const profiles = await sbGet(
      `profiles?strava_access_token=not.is.null&select=id`
    );

    if (!Array.isArray(profiles) || profiles.length === 0) {
      return res.json({ message: 'No users to process' });
    }

    const results = [];
    for (const profile of profiles) {
      try {
        const result = await updatePRForUser(profile.id);
        results.push({ userId: profile.id, status: 'success', ...result });
      } catch (e) {
        results.push({ userId: profile.id, status: 'error', error: e.message });
      }
    }

    const totalImproved = results.reduce((s, r) => s + (r.improved?.length || 0), 0);
    res.json({ success: true, processed: profiles.length, totalImproved, results });

  } catch (error) {
    console.error('PR update cron error:', error);
    res.status(500).json({ error: error.message });
  }
}
