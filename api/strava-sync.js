const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbGet(table, filter) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  return res.json();
}

async function sbPost(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(data)
  });
  return res;
}

async function sbPatch(table, filter, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(data)
  });
  return res;
}

async function refreshStravaToken(refreshToken) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  return res.json();
}

async function analyzeActivity(activity, goal) {
  const km = (activity.distance / 1000).toFixed(1);
  const paceSecPerKm = activity.moving_time / (activity.distance / 1000);
  const paceMins = Math.floor(paceSecPerKm / 60);
  const paceSecs = Math.round(paceSecPerKm % 60);
  const paceStr = `${paceMins}:${String(paceSecs).padStart(2, '0')}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `스트라바 운동 기록을 분석해줘.
종목: ${activity.type}
거리: ${km}km
시간: ${Math.floor(activity.moving_time / 60)}분
페이스: ${paceStr}/km
칼로리: ${activity.calories || '미측정'}
고도: ${activity.total_elevation_gain}m

목표: ${goal?.race_name || '마라톤'} ${goal?.target_time || '완주'} (목표페이스 ${goal?.target_pace || '-'}/km)

한국어로 3-4문장으로 성과 요약과 개선점을 알려줘. 목표 페이스 대비 평가도 포함해줘.`
      }]
    })
  });

  const data = await res.json();
  return data.content?.[0]?.text || '분석을 불러올 수 없습니다.';
}

async function sendTelegram(chatId, message) {
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
  });
}

export default async function handler(req, res) {
  const userId = req.query.user_id || req.body?.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'user_id required' });
  }

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

    // 토큰 갱신
    const newToken = await refreshStravaToken(profile.strava_refresh_token);
    const accessToken = newToken.access_token || profile.strava_access_token;

    if (newToken.access_token) {
      await sbPatch('profiles', `id=eq.${userId}`, {
        strava_access_token: newToken.access_token,
        strava_refresh_token: newToken.refresh_token
      });
    }

    // 최근 7일 활동 가져오기
    const after = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
    const activitiesRes = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=10`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const activities = await activitiesRes.json();

    if (!Array.isArray(activities) || activities.length === 0) {
      return res.json({ message: 'No new activities', synced: 0 });
    }

    let newCount = 0;
    for (const activity of activities) {
      // 이미 저장된 활동 확인
      const existing = await sbGet('activities', `strava_id=eq.${activity.id}&user_id=eq.${userId}`);
      if (existing.length > 0) continue;

      // Claude 분석
      const analysis = await analyzeActivity(activity, goal);

      // 저장
      await sbPost('activities', {
        user_id: userId,
        strava_id: String(activity.id),
        name: activity.name,
        type: activity.type,
        distance: activity.distance,
        moving_time: activity.moving_time,
        average_speed: activity.average_speed,
        calories: activity.calories,
        start_date: activity.start_date,
        analysis
      });

      // 텔레그램
      const km = (activity.distance / 1000).toFixed(1);
      const mins = Math.floor(activity.moving_time / 60);
      const paceSecPerKm = activity.moving_time / (activity.distance / 1000);
      const paceMins = Math.floor(paceSecPerKm / 60);
      const paceSecs = Math.round(paceSecPerKm % 60);

      const msg = `🏃 <b>${activity.name}</b>\n` +
        `📏 거리: ${km}km\n` +
        `⏱ 시간: ${Math.floor(mins/60)}:${String(mins%60).padStart(2,'0')}:${String(activity.moving_time%60).padStart(2,'0')}\n` +
        `⚡ 페이스: ${paceMins}:${String(paceSecs).padStart(2,'0')}/km\n\n` +
        `🤖 <b>AI 분석</b>\n${analysis}`;

      await sendTelegram(profile.telegram_chat_id, msg);
      newCount++;
    }

    res.json({ success: true, synced: newCount });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: error.message });
  }
}
