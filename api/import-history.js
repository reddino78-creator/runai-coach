const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbGet(table, filter) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
}

async function sbPost(table, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal'
    },
    body: JSON.stringify(data)
  });
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

function calcPace(movingTime, distance) {
  if (!distance || distance === 0) return '-';
  const sec = movingTime / (distance / 1000);
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

function paceToSec(paceStr) {
  if (!paceStr || paceStr === '-') return 999;
  const [m, s] = paceStr.split(':').map(Number);
  return m * 60 + s;
}

function classifyWorkout(activity, targetPace) {
  const km = activity.distance / 1000;
  const pace = calcPace(activity.moving_time, activity.distance);
  const paceSec = paceToSec(pace);
  const targetSec = paceToSec(targetPace);
  const diff = paceSec - targetSec;

  if (km < 3) return '이지런';
  if (diff <= -25 && km <= 12) return '인터벌';
  if (diff <= -10 && km <= 15) return '템포런';
  if (diff <= 10 && km >= 8) return '페이스주';
  if (km >= 20) return 'LSD';
  if (km >= 15) return '롱런';
  return '이지런';
}

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

async function refreshToken(profile, userId) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: profile.strava_refresh_token,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  if (data.access_token) {
    await sbPatch('profiles', `id=eq.${userId}`, {
      strava_access_token: data.access_token,
      strava_refresh_token: data.refresh_token
    });
    return data.access_token;
  }
  return profile.strava_access_token;
}

export default async function handler(req, res) {
  const userId = req.query.user_id;
  const months = parseInt(req.query.months) || 12; // 기본 1년

  if (!userId) return res.status(400).json({ error: 'user_id required' });

  try {
    // 프로필 가져오기
    const profiles = await sbGet('profiles', `id=eq.${userId}`);
    const profile = profiles[0];
    if (!profile?.strava_access_token) {
      return res.status(400).json({ error: 'Strava not connected' });
    }

    // 목표 가져오기
    const goals = await sbGet('goals', `user_id=eq.${userId}&order=created_at.desc&limit=1`);
    const goal = goals[0];
    const targetPace = goal?.target_pace || '5:27';

    // 토큰 갱신
    const accessToken = await refreshToken(profile, userId);

    // 기간 설정
    const after = Math.floor(Date.now() / 1000) - months * 30 * 24 * 60 * 60;

    // Strava에서 전체 활동 가져오기 (페이지네이션)
    let allActivities = [];
    let page = 1;

    while (true) {
      const r = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const batch = await r.json();

      if (!Array.isArray(batch) || batch.length === 0) break;
      allActivities = allActivities.concat(batch);
      if (batch.length < 100) break;
      page++;
    }

    // 달리기 활동만 필터
    const runActivities = allActivities.filter(a =>
      a.type === 'Run' || a.type === 'VirtualRun' || a.sport_type === 'Run'
    );

    // 이미 저장된 활동 ID 목록
    const existingRes = await sbGet('activities', `user_id=eq.${userId}&select=strava_id`);
    const existingIds = new Set(existingRes.map(a => a.strava_id));

    // 새 활동만 필터
    const newActivities = runActivities.filter(a => !existingIds.has(String(a.id)));

    let saved = 0;
    // 분석 없이 데이터만 빠르게 저장
    for (const activity of newActivities) {
      const workoutType = classifyWorkout(activity, targetPace);
      const weekStart = getWeekStart(activity.start_date);

      await sbPost('activities', {
        user_id: userId,
        strava_id: String(activity.id),
        name: activity.name,
        type: activity.type,
        workout_type: workoutType,
        week_start: weekStart,
        distance: activity.distance,
        moving_time: activity.moving_time,
        average_speed: activity.average_speed,
        calories: activity.calories || null,
        start_date: activity.start_date,
        analysis: null // 분석은 나중에 별도로
      });
      saved++;
    }

    res.json({
      success: true,
      total_found: runActivities.length,
      already_saved: runActivities.length - newActivities.length,
      newly_saved: saved
    });

  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: error.message });
  }
}
