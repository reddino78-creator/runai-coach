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

function calcPace(movingTime, distance) {
  if (!distance || distance === 0) return '-';
  const paceSecPerKm = movingTime / (distance / 1000);
  const paceMins = Math.floor(paceSecPerKm / 60);
  const paceSecs = Math.round(paceSecPerKm % 60);
  return `${paceMins}:${String(paceSecs).padStart(2, '0')}`;
}

function getTrainingPhase(raceDate) {
  if (!raceDate) return '기초체력기';
  const daysLeft = Math.ceil((new Date(raceDate) - new Date()) / 86400000);
  if (daysLeft > 140) return '기초체력기';
  if (daysLeft > 84) return '훈련강화기';
  if (daysLeft > 42) return '피크훈련기';
  if (daysLeft > 14) return '테이퍼링기';
  return '레이스준비기';
}

function calcPaceOffset(targetPace, offsetSecs) {
  const parts = targetPace.split(':');
  const totalSecs = parseInt(parts[0]) * 60 + parseInt(parts[1]);
  const newSecs = totalSecs - offsetSecs;
  const mins = Math.floor(newSecs / 60);
  const secs = Math.abs(newSecs % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// ── 일일 분석 프롬프트 (1000자 이내) ──
async function analyzeDailyActivity(activity, goal, recentActivities) {
  const km = (activity.distance / 1000).toFixed(1);
  const pace = calcPace(activity.moving_time, activity.distance);
  const targetPace = goal?.target_pace || '5:27';
  const daysLeft = goal?.race_date
    ? Math.ceil((new Date(goal.race_date) - new Date()) / 86400000)
    : null;

  // 이번 주 총 거리
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekActivities = recentActivities.filter(a => new Date(a.start_date) >= weekStart);
  const weekKm = (weekActivities.reduce((sum, a) => sum + a.distance, 0) / 1000 + parseFloat(km)).toFixed(1);

  // 주간 목표 거리 (레이스까지 기간 기반)
  const trainingPhase = getTrainingPhase(goal?.race_date);
  const weeklyTarget = trainingPhase === '기초체력기' ? 50
    : trainingPhase === '훈련강화기' ? 65
    : trainingPhase === '피크훈련기' ? 75
    : 40;

  const prompt = `당신은 마라톤 코치입니다. 아래 데이터로 간결한 일일 분석을 작성하세요.

선수 정보:
- 목표: ${goal?.race_name || '마라톤'} ${goal?.target_time || ''} (${targetPace}/km)
- D-${daysLeft || '?'} | 훈련단계: ${trainingPhase}
- PR: 풀 ${goal?.pr_full || '-'} / 하프 ${goal?.pr_half || '-'}

오늘 운동:
- ${activity.type} ${km}km @ ${pace}/km
- 고도: ${activity.total_elevation_gain || 0}m

이번 주 현황:
- 누적: ${weekKm}km / 목표 ${weeklyTarget}km
- 최근 활동: ${recentActivities.slice(0,3).map(a => `${(a.distance/1000).toFixed(1)}km@${calcPace(a.moving_time,a.distance)}`).join(', ') || '없음'}

훈련 페이스 기준 (목표 ${targetPace} 기준):
- 인터벌: ${calcPaceOffset(targetPace, 30)}/km
- 템포런: ${calcPaceOffset(targetPace, 15)}/km  
- 장거리: ${calcPaceOffset(targetPace, -60)}/km
- 회복런: ${calcPaceOffset(targetPace, -40)}/km

다음 형식으로 1000자 이내로 작성하세요:

**오늘 평가**
(오늘 운동을 목표 페이스 대비 2-3문장으로 평가)

**이번 주 영향**
(오늘 운동이 주간 목표 달성에 미치는 영향 1-2문장)

**이번 주 남은 훈련**
(앞으로 해야 할 훈련을 구체적 페이스/거리 포함해서 2-3개로)`;

  const res = await callClaude(prompt, 800);
  return res;
}

// ── 주간 분석 프롬프트 (2000자 이내) ──
async function analyzeWeekly(userId, goal, accessToken) {
  const targetPace = goal?.target_pace || '5:27';
  const trainingPhase = getTrainingPhase(goal?.race_date);
  const daysLeft = goal?.race_date
    ? Math.ceil((new Date(goal.race_date) - new Date()) / 86400000)
    : null;

  // 지난 주 활동
  const lastWeekStart = Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60;
  const lastWeekEnd = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const allRecent = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${lastWeekStart}&before=${lastWeekEnd}&per_page=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  ).then(r => r.json());

  const lastWeekActs = Array.isArray(allRecent) ? allRecent : [];
  const lastWeekKm = (lastWeekActs.reduce((sum, a) => sum + a.distance, 0) / 1000).toFixed(1);
  const lastWeekSummary = lastWeekActs.map(a =>
    `- ${new Date(a.start_date).toLocaleDateString('ko-KR')} ${a.type} ${(a.distance/1000).toFixed(1)}km @ ${calcPace(a.moving_time, a.distance)}/km`
  ).join('\n') || '기록 없음';

  // 다음 주 주간 목표
  const weeklyTarget = trainingPhase === '기초체력기' ? 50
    : trainingPhase === '훈련강화기' ? 65
    : trainingPhase === '피크훈련기' ? 75
    : 40;

  const prompt = `당신은 마라톤 코치입니다. 지난 주를 평가하고 다음 주 훈련 계획을 세워주세요.

선수 정보:
- 목표: ${goal?.race_name || '마라톤'} ${goal?.target_time || ''} (목표페이스 ${targetPace}/km)
- D-${daysLeft || '?'} | 훈련단계: ${trainingPhase}
- PR: 풀 ${goal?.pr_full || '-'} / 하프 ${goal?.pr_half || '-'}

훈련 페이스 기준:
- 인터벌: ${calcPaceOffset(targetPace, 30)}/km
- 템포런: ${calcPaceOffset(targetPace, 15)}/km
- 장거리(LSD): ${calcPaceOffset(targetPace, -60)}/km
- 회복런: ${calcPaceOffset(targetPace, -40)}/km

지난 주 기록:
총 거리: ${lastWeekKm}km (목표: ${weeklyTarget}km)
${lastWeekSummary}

다음 형식으로 2000자 이내로 작성하세요:

**지난 주 평가**
(훈련량, 강도, 구성 평가 3-4문장)

**다음 주 훈련 계획 (총 ${weeklyTarget}km 목표)**

| 요일 | 훈련 | 거리 | 페이스 |
|------|------|------|--------|
| 월 | ... | ...km | .../km |
| 화 | ... | ...km | .../km |
| 수 | ... | ...km | .../km |
| 목 | ... | ...km | .../km |
| 금 | 휴식 | - | - |
| 토 | ... | ...km | .../km |
| 일 | ... | ...km | .../km |

**핵심 훈련 상세**

1. 인터벌 훈련
- 워밍업: 2km @ ${calcPaceOffset(targetPace, -40)}/km
- 본운동: 400m × N세트 @ ${calcPaceOffset(targetPace, 30)}/km + 200m 회복조깅
- 쿨다운: 1km @ ${calcPaceOffset(targetPace, -40)}/km

2. 장거리(LSD)
- 거리: Xkm @ ${calcPaceOffset(targetPace, -60)}/km
- 목적: (설명)

**이번 주 핵심 포인트**
(2-3가지 집중할 사항)`;

  return await callClaude(prompt, 1800);
}

// ── 월간 분석 프롬프트 (4000자 이내) ──
async function analyzeMonthly(userId, goal, accessToken) {
  const targetPace = goal?.target_pace || '5:27';
  const trainingPhase = getTrainingPhase(goal?.race_date);
  const daysLeft = goal?.race_date
    ? Math.ceil((new Date(goal.race_date) - new Date()) / 86400000)
    : null;

  // 지난 달 활동
  const lastMonthStart = Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60;
  const lastMonthEnd = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  const lastMonthRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${lastMonthStart}&before=${lastMonthEnd}&per_page=30`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  ).then(r => r.json());

  const lastMonthActs = Array.isArray(lastMonthRes) ? lastMonthRes : [];
  const lastMonthKm = (lastMonthActs.reduce((sum, a) => sum + a.distance, 0) / 1000).toFixed(1);
  const avgPaceTotal = lastMonthActs.length > 0
    ? lastMonthActs.reduce((sum, a) => sum + (a.moving_time / (a.distance / 1000)), 0) / lastMonthActs.length
    : 0;
  const avgPaceMins = Math.floor(avgPaceTotal / 60);
  const avgPaceSecs = Math.round(avgPaceTotal % 60);
  const avgPaceStr = avgPaceTotal > 0 ? `${avgPaceMins}:${String(avgPaceSecs).padStart(2,'0')}` : '-';

  const prompt = `당신은 마라톤 전문 코치입니다. 지난 달을 종합 평가하고 다음 달 훈련 로드맵을 작성하세요.

선수 정보:
- 목표: ${goal?.race_name || '마라톤'} ${goal?.target_time || ''} (목표페이스 ${targetPace}/km)
- D-${daysLeft || '?'} | 현재 훈련단계: ${trainingPhase}
- PR: 풀 ${goal?.pr_full || '-'} / 하프 ${goal?.pr_half || '-'} / 10K ${goal?.pr_10k || '-'}

훈련 페이스 기준:
- 인터벌: ${calcPaceOffset(targetPace, 30)}/km
- 템포런: ${calcPaceOffset(targetPace, 15)}/km
- 장거리(LSD): ${calcPaceOffset(targetPace, -60)}/km
- 회복런: ${calcPaceOffset(targetPace, -40)}/km

지난 달 데이터:
- 총 거리: ${lastMonthKm}km
- 평균 페이스: ${avgPaceStr}/km
- 총 운동 횟수: ${lastMonthActs.length}회

다음 형식으로 4000자 이내로 작성하세요:

## 지난 달 종합 평가

**훈련량 분석**
(목표 대비 달성률, 주간 평균 거리, 평가 3-4문장)

**훈련 질 분석**
(페이스 트렌드, 인터벌/장거리/회복런 비율, 강점과 약점)

**현재 목표 달성 가능성: X%**
(현재 상태 기준 솔직한 평가 2-3문장)

---

## 다음 달 훈련 로드맵

**다음 달 목표**
- 월간 목표 거리: Xkm
- 핵심 훈련 목표: (2-3가지)

**주차별 계획**

1주차 (적응):
- 주간 거리: Xkm
- 핵심 훈련: (구체적 훈련명, 페이스, 거리)

2주차 (발전):
- 주간 거리: Xkm  
- 핵심 훈련: (구체적 훈련명, 페이스, 거리)

3주차 (강화):
- 주간 거리: Xkm
- 핵심 훈련: (구체적 훈련명, 페이스, 거리)

4주차 (회복):
- 주간 거리: Xkm
- 핵심 훈련: (회복 위주)

**다음 달 미션 완료 시 달성 가능성: X%**
(미션 완료 시 예상 페이스 향상과 가능성 상승 근거 3-4문장)

**이달의 핵심 메시지**
(코치로서 한 마디, 동기부여 포함)`;

  return await callClaude(prompt, 3500);
}

// ── Claude API 호출 ──
async function callClaude(prompt, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || '분석을 불러올 수 없습니다.';
}

// ── 마크다운 → 텔레그램 HTML 변환 ──
function mdToTelegram(text) {
  return text
    .replace(/#{1,3} (.+)/g, '\n<b>$1</b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/【(.+?)】/g, '\n<b>【$1】</b>')
    .replace(/\|.+\|/g, '')
    .replace(/[-]{3,}/g, '─────────────')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function sendTelegram(chatId, title, analysis) {
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return;
  const cleanAnalysis = mdToTelegram(analysis);
  const message = `${title}\n─────────────\n${cleanAnalysis}`;
  const truncated = message.length > 4096 ? message.substring(0, 4090) + '...' : message;

  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: truncated,
      parse_mode: 'HTML'
    })
  });
}

export default async function handler(req, res) {
  const userId = req.query.user_id || req.body?.user_id;
  const type = req.query.type || 'daily'; // daily | weekly | monthly

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

    // ── 주간 분석 ──
    if (type === 'weekly') {
      const analysis = await analyzeWeekly(userId, goal, accessToken);
      await sendTelegram(profile.telegram_chat_id, '📅 <b>주간 훈련 리포트</b>', analysis);
      return res.json({ success: true, type: 'weekly' });
    }

    // ── 월간 분석 ──
    if (type === 'monthly') {
      const analysis = await analyzeMonthly(userId, goal, accessToken);
      await sendTelegram(profile.telegram_chat_id, '📊 <b>월간 훈련 리포트</b>', analysis);
      return res.json({ success: true, type: 'monthly' });
    }

    // ── 일일 분석 (기본) ──
    const activityId = req.query.activity_id; // Webhook에서 특정 activity_id 전달 시
    let activities = [];

    if (activityId) {
      // Webhook에서 특정 활동 ID가 전달된 경우 해당 활동만 가져오기
      const actRes = await fetch(
        `https://www.strava.com/api/v3/activities/${activityId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const act = await actRes.json();
      if (act.id) activities = [act];
    } else {
      // 일반 동기화: 최근 7일 활동 가져오기
      const after = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
      const activitiesRes = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=20`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      activities = await activitiesRes.json();
    }

    if (!Array.isArray(activities) || activities.length === 0) {
      return res.json({ message: 'No new activities', synced: 0 });
    }

    const recentSaved = await sbGet('activities',
      `user_id=eq.${userId}&order=start_date.desc&limit=7`
    );

    let newCount = 0;
    for (const activity of activities) {
      const existing = await sbGet('activities',
        `strava_id=eq.${activity.id}&user_id=eq.${userId}`
      );
      if (existing.length > 0) continue;

      const contextActivities = recentSaved.slice(0, 6);
      const analysis = await analyzeDailyActivity(activity, goal, contextActivities);
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

      const title = `🏃 <b>${activity.name}</b>\n📏 ${km}km | ⚡ ${pace}/km`;
      await sendTelegram(profile.telegram_chat_id, title, analysis);
      newCount++;
    }

    res.json({ success: true, synced: newCount });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: error.message });
  }
}
