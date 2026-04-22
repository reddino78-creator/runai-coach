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

// 페이스 계산 헬퍼
function calcPace(movingTime, distance) {
  if (!distance || distance === 0) return '-';
  const paceSecPerKm = movingTime / (distance / 1000);
  const paceMins = Math.floor(paceSecPerKm / 60);
  const paceSecs = Math.round(paceSecPerKm % 60);
  return `${paceMins}:${String(paceSecs).padStart(2, '0')}`;
}

// 훈련 단계 계산
function getTrainingPhase(raceDate) {
  if (!raceDate) return '기초체력기';
  const daysLeft = Math.ceil((new Date(raceDate) - new Date()) / 86400000);
  if (daysLeft > 140) return '기초체력기';
  if (daysLeft > 84) return '훈련강화기';
  if (daysLeft > 42) return '피크훈련기';
  if (daysLeft > 14) return '테이퍼링기';
  return '레이스준비기';
}

// 목표 페이스보다 빠른 페이스 계산 (인터벌용)
function calcIntervalPace(targetPace, offset) {
  const parts = targetPace.split(':');
  const totalSecs = parseInt(parts[0]) * 60 + parseInt(parts[1]);
  const newSecs = totalSecs - offset;
  const mins = Math.floor(newSecs / 60);
  const secs = newSecs % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

async function analyzeActivity(activity, goal, recentActivities) {
  const km = (activity.distance / 1000).toFixed(1);
  const pace = calcPace(activity.moving_time, activity.distance);
  const daysLeft = goal?.race_date
    ? Math.ceil((new Date(goal.race_date) - new Date()) / 86400000)
    : null;
  const trainingPhase = getTrainingPhase(goal?.race_date);

  // 최근 7일 훈련 요약
  const recentSummary = recentActivities.map(a => {
    const aKm = (a.distance / 1000).toFixed(1);
    const aPace = calcPace(a.moving_time, a.distance);
    return `- ${new Date(a.start_date).toLocaleDateString('ko-KR')}: ${a.type} ${aKm}km @ ${aPace}/km`;
  }).join('\n');

  const totalRecentKm = recentActivities.reduce((sum, a) => sum + a.distance, 0) / 1000;

  // 목표 페이스 기반 훈련 페이스 계산
  const targetPace = goal?.target_pace || '5:27';
  const intervalPace = calcIntervalPace(targetPace, 30); // 목표보다 30초 빠르게
  const tempoRacePace = calcIntervalPace(targetPace, 15); // 목표보다 15초 빠르게
  const easyPace = calcIntervalPace(targetPace, -40); // 목표보다 40초 느리게 (회복런)
  const lsdPace = calcIntervalPace(targetPace, -60); // 목표보다 60초 느리게 (장거리)

  const prompt = `당신은 마라톤 전문 코치입니다. 아래 데이터를 기반으로 상세한 훈련 분석과 처방을 제공해주세요.

═══════════════════════════
📋 선수 프로필
═══════════════════════════
목표 대회: ${goal?.race_name || '마라톤'} 
목표 기록: ${goal?.target_time || '-'} (목표 페이스: ${targetPace}/km)
레이스까지: ${daysLeft ? `${daysLeft}일` : '미설정'}
현재 훈련 단계: ${trainingPhase}
훈련 수준: ${goal?.level || '고급자'}

개인 최고 기록 (PR):
- 풀코스: ${goal?.pr_full || '미입력'}
- 하프코스: ${goal?.pr_half || '미입력'}
- 10K: ${goal?.pr_10k || '미입력'}
- 5K: ${goal?.pr_5k || '미입력'}

훈련 페이스 기준:
- 인터벌: ${intervalPace}/km
- 템포런: ${tempoRacePace}/km
- 장거리(LSD): ${lsdPace}/km
- 회복런: ${easyPace}/km

═══════════════════════════
📊 최근 7일 훈련 기록
═══════════════════════════
주간 총 거리: ${totalRecentKm.toFixed(1)}km
${recentSummary || '기록 없음'}

═══════════════════════════
🏃 오늘 운동
═══════════════════════════
종목: ${activity.type}
거리: ${km}km
시간: ${Math.floor(activity.moving_time / 60)}분
페이스: ${pace}/km
고도: ${activity.total_elevation_gain || 0}m
칼로리: ${activity.calories || '미측정'}

═══════════════════════════

다음 형식으로 정확하게 분석해주세요:

【오늘 운동 평가】
목표 페이스(${targetPace}/km) 대비 오늘 페이스(${pace}/km) 평가. 잘한 점과 부족한 점 2-3문장.

【훈련 패턴 분석】
최근 7일 훈련량과 구성(장거리/인터벌/회복런 비율)의 문제점 또는 강점. 2-3문장.

【다음 훈련 처방】
${trainingPhase} 단계에 맞는 구체적 훈련 3가지:

1. [인터벌 훈련]
   - 워밍업: 2km @ ${easyPace}/km
   - 본운동: 400m × N세트 @ ${intervalPace}/km + 200m 회복 조깅 @ ${easyPace}/km
   - 쿨다운: 1km @ ${easyPace}/km
   - 총 거리: Xkm / 권장 요일: X요일

2. [템포런 or 장거리(LSD)]
   - 거리: Xkm
   - 페이스: X:XX/km
   - 목적: (구체적 설명)
   - 권장 요일: X요일

3. [회복런]
   - 거리: Xkm  
   - 페이스: ${easyPace}/km
   - 권장 요일: X요일

【목표 달성 가능성】
현재 훈련 상태 기준 목표 달성 가능성: X%
한 줄 총평.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
  return data.content?.[0]?.text || '분석을 불러올 수 없습니다.';
}

async function sendTelegram(chatId, activityName, km, pace, analysis) {
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return;

  const message =
    `🏃 <b>${activityName}</b>\n` +
    `📏 ${km}km | ⚡ ${pace}/km\n\n` +
    `${analysis}`;

  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    })
  });
}

export default async function handler(req, res) {
  const userId = req.query.user_id || req.body?.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });

  try {
    const profiles = await sbGet('profiles', `id=eq.${userId}`);
    const profile = profiles[0];
    if (!profile?.strava_access_token) {
      return res.status(400).json({ error: 'Strava not connected' });
    }

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

    // 최근 7일 활동
    const after = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
    const activitiesRes = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=20`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const activities = await activitiesRes.json();
    if (!Array.isArray(activities) || activities.length === 0) {
      return res.json({ message: 'No new activities', synced: 0 });
    }

    // DB에 저장된 최근 활동 (컨텍스트용)
    const recentSaved = await sbGet('activities',
      `user_id=eq.${userId}&order=start_date.desc&limit=7`
    );

    let newCount = 0;
    for (const activity of activities) {
      const existing = await sbGet('activities',
        `strava_id=eq.${activity.id}&user_id=eq.${userId}`
      );
      if (existing.length > 0) continue;

      // 이전 활동들을 컨텍스트로 전달 (현재 활동 제외)
      const contextActivities = recentSaved.slice(0, 6);

      const analysis = await analyzeActivity(activity, goal, contextActivities);
      const km = (activity.distance / 1000).toFixed(1);
      const pace = calcPace(activity.moving_time, activity.distance);

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

      await sendTelegram(profile.telegram_chat_id, activity.name, km, pace, analysis);
      newCount++;
    }

    res.json({ success: true, synced: newCount });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: error.message });
  }
}
