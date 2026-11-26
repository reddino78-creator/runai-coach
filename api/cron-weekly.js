// 매주 월요일 오전 8시 자동 실행
// ① 모든 Strava 연동 사용자에게 주간 분석 발송
// ② 최근 1년 활동에서 PR 자동 갱신

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
function extractBestTimes(activities) {
  const runTypes = ['Run', 'VirtualRun', 'TrailRun', '러닝', '트레일런'];
  const runs = activities.filter(a => {
    const t = a.sport_type || a.type || '';
    return runTypes.some(r => t.includes(r));
  });

  const ranges = {
    pr_full:  { min: 41000, max: 44000, label: '풀마라톤' },
    pr_half:  { min: 20000, max: 23000, label: '하프마라톤' },
    pr_10k:   { min:  9000, max: 11500, label: '10K' },
    pr_5k:    { min:  4500, max:  6000, label: '5K' },
  };

  const best = {};
  for (const [key, range] of Object.entries(ranges)) {
    const matched = runs.filter(a => a.distance >= range.min && a.distance <= range.max);
    if (matched.length === 0) continue;
    const fastest = matched.reduce((prev, cur) =>
      cur.moving_time < prev.moving_time ? cur : prev
    );
    best[key] = {
      timeSec: fastest.moving_time,
      timeStr: secToTime(fastest.moving_time),
      date: fastest.start_date?.slice(0, 10),
      name: fastest.name,
      label: range.label
    };
  }
  return best;
}

// ── PR 갱신 (사용자별) ──
async function updatePRForUser(userId) {
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const activities = await sbGet(
    `activities?user_id=eq.${userId}&start_date=gte.${oneYearAgo}&select=sport_type,type,distance,moving_time,start_date,name&order=start_date.desc&limit=500`
  );
  if (!Array.isArray(activities) || activities.length === 0) return [];

  const goals = await sbGet(
    `goals?user_id=eq.${userId}&select=id,pr_full,pr_half,pr_10k,pr_5k&order=created_at.desc&limit=1`
  );
  const goal = Array.isArray(goals) && goals[0];
  if (!goal) return [];

  const bestTimes = extractBestTimes(activities);
  const updates = {};
  const improved = [];

  for (const [key, best] of Object.entries(bestTimes)) {
    const currentSec = timeToSec(goal[key]);
    if (best.timeSec < currentSec) {
      updates[key] = best.timeStr;
      improved.push({ label: best.label, old: goal[key] || '-', new: best.timeStr, date: best.date, activity: best.name });
    }
  }

  if (Object.keys(updates).length > 0) {
    await sbPatch('goals', `user_id=eq.${userId}`, updates);
  }

  return improved;
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const profilesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?strava_access_token=not.is.null&select=id,telegram_chat_id`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const profiles = await profilesRes.json();

    if (!Array.isArray(profiles) || profiles.length === 0) {
      return res.json({ message: 'No users to process' });
    }

    const results = [];

    for (const profile of profiles) {
      const result = { userId: profile.id, weekly: null, prImproved: [] };

      // ① 주간 분석
      try {
        const syncRes = await fetch(
          `https://runai-coach.vercel.app/api/strava-sync?user_id=${profile.id}&type=weekly`,
          { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` } }
        );
        result.weekly = await syncRes.json();
      } catch (e) {
        result.weekly = { error: e.message };
      }

      // ② PR 갱신
      try {
        const improved = await updatePRForUser(profile.id);
        result.prImproved = improved;

        if (improved.length > 0 && profile.telegram_chat_id) {
          const lines = improved.map(i =>
            `🏅 <b>${i.label}</b>: ${i.old} → <b>${i.new}</b>\n   📅 ${i.date} · ${i.activity}`
          ).join('\n\n');
          await sendTelegram(profile.telegram_chat_id,
            `🎉 <b>개인 최고 기록(PB) 자동 갱신!</b>\n\nStrava 최근 1년 기록 분석 결과,\n새로운 PB가 발견됐어요!\n\n${lines}\n\n🔗 BaBa School에서 확인하세요`
          );
        }
      } catch (e) {
        result.prError = e.message;
      }

      results.push(result);
    }

    const totalPR = results.reduce((s, r) => s + (r.prImproved?.length || 0), 0);
    res.json({ success: true, processed: profiles.length, totalPRUpdated: totalPR, results });

  } catch (error) {
    console.error('Weekly cron error:', error);
    res.status(500).json({ error: error.message });
  }
}
