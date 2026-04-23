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

// ── 헬퍼 함수 ──
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

function getSportType(activity) {
  const type = activity.sport_type || activity.type || '';
  if (type === 'TrailRun') return '트레일런';
  if (type === 'Run' || type === 'VirtualRun') return '러닝';
  if (type === 'Walk' || type === 'Hike') return '워킹/하이킹';
  if (type === 'Swim') return '수영';
  if (type === 'Ride' || type === 'VirtualRide' || type === 'EBikeRide') return '자전거';
  if (type === 'WeightTraining' || type === 'Workout') return '근력훈련';
  return type || '기타';
}

function isCrossTraining(sportType) {
  return ['워킹/하이킹', '수영', '자전거', '근력훈련', '기타'].includes(sportType);
}

function calcAdjustedPace(movingTime, distance, elevation) {
  if (!distance || distance === 0) return '-';
  const elevationBonus = (elevation || 0) / 100 * 60;
  const adjustedTime = movingTime + elevationBonus;
  const sec = adjustedTime / (distance / 1000);
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

function classifyWorkout(activity, targetPace, sportType) {
  if (isCrossTraining(sportType)) return sportType;
  const km = activity.distance / 1000;
  const pace = sportType === '트레일런'
    ? calcAdjustedPace(activity.moving_time, activity.distance, activity.total_elevation_gain)
    : calcPace(activity.moving_time, activity.distance);
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

// ── Strava 상세 데이터 가져오기 ──
async function fetchActivityDetails(activityId, accessToken) {
  try {
    const [lapsRes, streamsRes] = await Promise.all([
      fetch(`https://www.strava.com/api/v3/activities/${activityId}/laps`,
        { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch(`https://www.strava.com/api/v3/activities/${activityId}/streams?keys=heartrate,cadence,altitude&key_by_type=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } })
    ]);
    const laps = await lapsRes.json();
    const streams = await streamsRes.json();
    return {
      laps: Array.isArray(laps) ? laps : [],
      streams: streams || {}
    };
  } catch (e) {
    return { laps: [], streams: {} };
  }
}

// ── 토큰 갱신 ──
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
  const months = parseInt(req.query.months) || 12;
  const detailMonths = 2;

  if (!userId) return res.status(400).json({ error: 'user_id required' });

  // ── 인증 체크: Supabase JWT 검증 ──
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const verifyRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`
      }
    });
    const userData = await verifyRes.json();

    if (!userData?.id || userData.id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const profiles = await sbGet('profiles', `id=eq.${userId}`);
    const profile = profiles[0];
    if (!profile?.strava_access_token) {
      return res.status(400).json({ error: 'Strava not connected' });
    }

    const goals = await sbGet('goals', `user_id=eq.${userId}&order=created_at.desc&limit=1`);
    const goal = goals[0];
    const targetPace = goal?.target_pace || '5:27';
    const accessToken = await refreshToken(profile, userId);

    // 기간 설정
    const after = Math.floor(Date.now() / 1000) - months * 30 * 24 * 60 * 60;
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - detailMonths);

    // Strava 전체 활동 가져오기
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

    // 운동 활동만 필터 (모든 종류 포함)
    const validActivities = allActivities.filter(a =>
      ['Run', 'VirtualRun', 'TrailRun', 'Walk', 'Hike', 'Swim', 'Ride', 'VirtualRide', 'WeightTraining', 'Workout'].includes(a.sport_type || a.type)
    );

    // 이미 저장된 활동 ID
    const existingRes = await sbGet('activities', `user_id=eq.${userId}&select=strava_id`);
    const existingIds = new Set(existingRes.map(a => a.strava_id));

    const newActivities = validActivities.filter(a => !existingIds.has(String(a.id)));

    // 2개월 이내 / 이전 구분
    const recentActivities = newActivities.filter(a => new Date(a.start_date) >= twoMonthsAgo);
    const oldActivities = newActivities.filter(a => new Date(a.start_date) < twoMonthsAgo);

    let saved = 0;

    // ── 1단계: 오래된 활동 (기본 정보만) ──
    for (const activity of oldActivities) {
      const sportType = getSportType(activity);
      const workoutType = classifyWorkout(activity, targetPace, sportType);
      const weekStart = getWeekStart(activity.start_date);
      const adjustedPace = sportType === '트레일런'
        ? calcAdjustedPace(activity.moving_time, activity.distance, activity.total_elevation_gain)
        : null;

      await sbPost('activities', {
        user_id: userId,
        strava_id: String(activity.id),
        name: activity.name,
        type: activity.type,
        sport_type: sportType,
        workout_type: workoutType,
        week_start: weekStart,
        distance: activity.distance,
        moving_time: activity.moving_time,
        average_speed: activity.average_speed,
        calories: activity.calories || null,
        start_date: activity.start_date,
        total_elevation_gain: activity.total_elevation_gain || 0,
        adjusted_pace: adjustedPace,
        analysis: null
      });
      saved++;
    }

    // ── 2단계: 최근 2개월 활동 (상세 데이터 포함) ──
    for (const activity of recentActivities) {
      const sportType = getSportType(activity);
      const workoutType = classifyWorkout(activity, targetPace, sportType);
      const weekStart = getWeekStart(activity.start_date);
      const adjustedPace = sportType === '트레일런'
        ? calcAdjustedPace(activity.moving_time, activity.distance, activity.total_elevation_gain)
        : null;

      // 상세 데이터 가져오기
      const details = await fetchActivityDetails(activity.id, accessToken);

      const hrData = details.streams?.heartrate?.data || [];
      const cadData = details.streams?.cadence?.data || [];
      const avgHR = hrData.length > 0 ? Math.round(hrData.reduce((s, v) => s + v, 0) / hrData.length) : null;
      const avgCad = cadData.length > 0 ? Math.round(cadData.reduce((s, v) => s + v, 0) / cadData.length * 2) : null;

      await sbPost('activities', {
        user_id: userId,
        strava_id: String(activity.id),
        name: activity.name,
        type: activity.type,
        sport_type: sportType,
        workout_type: workoutType,
        week_start: weekStart,
        distance: activity.distance,
        moving_time: activity.moving_time,
        average_speed: activity.average_speed,
        calories: activity.calories || null,
        start_date: activity.start_date,
        total_elevation_gain: activity.total_elevation_gain || 0,
        avg_heartrate: avgHR,
        max_heartrate: activity.max_heartrate || null,
        avg_cadence: avgCad,
        adjusted_pace: adjustedPace,
        laps: details.laps.length > 0 ? JSON.stringify(details.laps) : null,
        analysis: null
      });
      saved++;
    }

    res.json({
      success: true,
      total_found: validActivities.length,
      already_saved: validActivities.length - newActivities.length,
      newly_saved: saved,
      basic_data: oldActivities.length,
      detailed_data: recentActivities.length
    });

  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: error.message });
  }
}
