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

async function sbUpsert(table, data, onConflict) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal'
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

function calcPaceOffset(targetPace, offsetSecs) {
  const total = paceToSec(targetPace) - offsetSecs;
  return `${Math.floor(total / 60)}:${String(Math.abs(total % 60)).padStart(2, '0')}`;
}

function getTrainingPhase(raceDate) {
  if (!raceDate) return '기초체력기';
  const d = Math.ceil((new Date(raceDate) - new Date()) / 86400000);
  if (d > 140) return '기초체력기';
  if (d > 84) return '훈련강화기';
  if (d > 42) return '피크훈련기';
  if (d > 14) return '테이퍼링기';
  return '레이스준비기';
}

function getWeeklyTarget(phase) {
  return phase === '기초체력기' ? 50 : phase === '훈련강화기' ? 65 : phase === '피크훈련기' ? 75 : 40;
}

// ── 운동 종류 구분 ──
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

// ── 트레일런 고도 환산 페이스 ──
function calcAdjustedPace(movingTime, distance, elevation) {
  if (!distance || distance === 0) return '-';
  // 고도 100m 상승 = +1분/km 추가
  const elevationBonus = (elevation || 0) / 100 * 60; // 초 단위
  const adjustedTime = movingTime + elevationBonus;
  const sec = adjustedTime / (distance / 1000);
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

// ── 훈련 종류 자동 분류 ──
function classifyWorkout(activity, targetPace, sportType) {
  // 크로스트레이닝은 별도 분류
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

// ── 웜업/주훈련/쿨다운 구간 분석 ──
function analyzePhases(laps, targetPace) {
  if (!laps || laps.length < 3) return null;

  const targetSec = paceToSec(targetPace);
  const phases = { warmup: [], main: [], cooldown: [] };

  laps.forEach((lap, i) => {
    const lapPaceSec = lap.moving_time / (lap.distance / 1000);
    const diff = lapPaceSec - targetSec;

    if (i < 2 && diff > 30) {
      phases.warmup.push(lap);
    } else if (i >= laps.length - 2 && diff > 20) {
      phases.cooldown.push(lap);
    } else {
      phases.main.push(lap);
    }
  });

  const warmupKm = (phases.warmup.reduce((s, l) => s + l.distance, 0) / 1000).toFixed(1);
  const mainKm = (phases.main.reduce((s, l) => s + l.distance, 0) / 1000).toFixed(1);
  const cooldownKm = (phases.cooldown.reduce((s, l) => s + l.distance, 0) / 1000).toFixed(1);

  const mainPaceSec = phases.main.length > 0
    ? phases.main.reduce((s, l) => s + l.moving_time / (l.distance / 1000), 0) / phases.main.length
    : 0;
  const mainPace = mainPaceSec > 0
    ? `${Math.floor(mainPaceSec / 60)}:${String(Math.round(mainPaceSec % 60)).padStart(2, '0')}`
    : '-';

  return { warmupKm, mainKm, cooldownKm, mainPace };
}

// ── 주간 시작일 ──
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
    // 랩 데이터
    const lapsRes = await fetch(
      `https://www.strava.com/api/v3/activities/${activityId}/laps`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const laps = await lapsRes.json();

    // 스트림 데이터 (심박수, 케이던스, 고도)
    const streamsRes = await fetch(
      `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=heartrate,cadence,altitude&key_by_type=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const streams = await streamsRes.json();

    return { laps: Array.isArray(laps) ? laps : [], streams };
  } catch (e) {
    console.error('Activity details error:', e);
    return { laps: [], streams: {} };
  }
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

// ── 마크다운 → 텔레그램 HTML ──
function mdToTelegram(text) {
  return text
    .replace(/#{1,3} (.+)/g, '\n<b>$1</b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\|.+\|/g, '')
    .replace(/[-]{3,}/g, '─────────')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function sendTelegram(chatId, title, analysis) {
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return;
  const msg = `${title}\n─────────\n${mdToTelegram(analysis)}`;
  const truncated = msg.length > 4096 ? msg.substring(0, 4090) + '...' : msg;
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: truncated, parse_mode: 'HTML' })
  });
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

// ══════════════════════════════════════
// 일일 분석 (1000자 이내)
// ══════════════════════════════════════
async function analyzeDailyActivity(activity, goal, recentActivities, workoutType, sportType, phases, details) {
  const km = (activity.distance / 1000).toFixed(1);
  const pace = calcPace(activity.moving_time, activity.distance);
  const targetPace = goal?.target_pace || '5:27';
  const trainingPhase = getTrainingPhase(goal?.race_date);
  const weeklyTarget = getWeeklyTarget(trainingPhase);
  const daysLeft = goal?.race_date ? Math.ceil((new Date(goal.race_date) - new Date()) / 86400000) : null;
  const isCross = isCrossTraining(sportType);
  const isTrail = sportType === '트레일런';
  const adjustedPace = isTrail ? calcAdjustedPace(activity.moving_time, activity.distance, activity.total_elevation_gain) : pace;

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  const weekKm = (recentActivities
    .filter(a => new Date(a.start_date) >= weekStart)
    .reduce((s, a) => s + a.distance, 0) / 1000 + parseFloat(km)).toFixed(1);

  // 심박수/케이던스 요약
  const hrData = details?.streams?.heartrate?.data || [];
  const cadData = details?.streams?.cadence?.data || [];
  const avgHR = hrData.length > 0 ? Math.round(hrData.reduce((s, v) => s + v, 0) / hrData.length) : null;
  const avgCad = cadData.length > 0 ? Math.round(cadData.reduce((s, v) => s + v, 0) / cadData.length * 2) : null; // 양발 기준

  // 구간 분석
  const phaseInfo = phases ? `
웜업: ${phases.warmupKm}km
주훈련: ${phases.mainKm}km @ ${phases.mainPace}/km
쿨다운: ${phases.cooldownKm}km` : '구간 데이터 없음';

  const prompt = `마라톤 코치로서 간결한 일일 분석을 작성하세요.

선수: ${goal?.race_name || '마라톤'} ${goal?.target_time || ''} (목표페이스 ${targetPace}/km) | D-${daysLeft || '?'} | ${trainingPhase}
PR: 풀 ${goal?.pr_full || '-'} / 하프 ${goal?.pr_half || '-'}

오늘 운동:
- 종류: ${sportType} [${workoutType}]
- 거리: ${km}km | 시간: ${Math.floor(activity.moving_time / 60)}분
- 페이스: ${pace}/km ${isTrail ? `(고도 환산: ${adjustedPace}/km)` : ''}
- 고도: ${activity.total_elevation_gain || 0}m
${avgHR ? `- 평균 심박수: ${avgHR}bpm` : ''}
${avgCad ? `- 케이던스: ${avgCad}spm (권장: 170~180spm)` : ''}
- 구간: ${phaseInfo}

이번 주: ${weekKm}km / ${weeklyTarget}km 목표
최근 활동: ${recentActivities.slice(0,3).map(a => `${getSportType(a)} ${(a.distance/1000).toFixed(1)}km@${calcPace(a.moving_time,a.distance)}`).join(', ') || '없음'}

훈련 페이스: 인터벌 ${calcPaceOffset(targetPace,30)} | 템포 ${calcPaceOffset(targetPace,15)} | LSD ${calcPaceOffset(targetPace,-60)} | 회복 ${calcPaceOffset(targetPace,-40)}

1000자 이내로 작성:

**오늘 평가**
${isCross ? '크로스트레이닝 관점에서 마라톤 훈련에 미치는 영향 평가' : isTrail ? '트레일런 강도를 고도 환산 페이스 기준으로 평가' : '목표 페이스 대비 평가, 웜업/주훈련/쿨다운 구성 평가'}
${avgHR ? '심박수 기반 강도 평가 포함' : ''}
${avgCad ? '케이던스 평가 및 개선 방향 포함' : ''}

**이번 주 영향**
(주간 목표 달성에 미치는 영향 1문장)

**남은 훈련 처방**
(이번 주 남은 훈련 2-3개, 구체적 페이스/거리 포함)`;

  return callClaude(prompt, 800);
}

// ══════════════════════════════════════
// 주간 분석 (2000자 이내)
// ══════════════════════════════════════
async function analyzeWeekly(userId, goal, accessToken) {
  const targetPace = goal?.target_pace || '5:27';
  const trainingPhase = getTrainingPhase(goal?.race_date);
  const weeklyTarget = getWeeklyTarget(trainingPhase);
  const daysLeft = goal?.race_date ? Math.ceil((new Date(goal.race_date) - new Date()) / 86400000) : null;

  const lastWeekStart = Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60;
  const lastWeekEnd = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const lastWeekRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${lastWeekStart}&before=${lastWeekEnd}&per_page=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  ).then(r => r.json());

  const lastWeekActs = Array.isArray(lastWeekRes) ? lastWeekRes : [];
  const lastWeekKm = (lastWeekActs.reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);

  const lastWeekSummary = lastWeekActs.map(a => {
    const st = getSportType(a);
    const wt = classifyWorkout(a, targetPace, st);
    const adjustedPace = st === '트레일런'
      ? `(환산 ${calcAdjustedPace(a.moving_time, a.distance, a.total_elevation_gain)}/km)`
      : '';
    return `- [${st}/${wt}] ${(a.distance/1000).toFixed(1)}km @ ${calcPace(a.moving_time,a.distance)}/km ${adjustedPace} 고도${a.total_elevation_gain||0}m`;
  }).join('\n') || '기록 없음';

  const prompt = `마라톤 코치로서 주간 리포트를 작성하세요.

선수: ${goal?.race_name || '마라톤'} ${goal?.target_time || ''} (${targetPace}/km) | D-${daysLeft || '?'} | ${trainingPhase}
PR: 풀 ${goal?.pr_full || '-'} / 하프 ${goal?.pr_half || '-'}
훈련 페이스: 인터벌 ${calcPaceOffset(targetPace,30)} | 템포 ${calcPaceOffset(targetPace,15)} | LSD ${calcPaceOffset(targetPace,-60)} | 회복 ${calcPaceOffset(targetPace,-40)}

지난 주 기록 (총 ${lastWeekKm}km / 목표 ${weeklyTarget}km):
${lastWeekSummary}

2000자 이내로 작성:

**지난 주 평가**
(훈련량, 강도, 종류 구성 평가. 트레일런/크로스트레이닝 포함 시 마라톤 훈련 관점 평가. 3-4문장)

**다음 주 훈련 계획 (목표 ${weeklyTarget}km)**

| 요일 | 훈련 | 거리 | 페이스 |
|------|------|------|--------|
| 월 | | | |
| 화 | | | |
| 수 | | | |
| 목 | | | |
| 금 | 휴식 | - | - |
| 토 | | | |
| 일 | | | |

**핵심 훈련 상세**
1. [가장 중요한 훈련 - 웜업/주훈련/쿨다운 구간 포함]
2. [두 번째 훈련]

**이번 주 핵심 포인트**
(집중할 2-3가지, 케이던스/심박수 관련 포함)`;

  const analysis = await callClaude(prompt, 1800);
  await saveWeeklyPlan(userId, analysis, goal);
  return analysis;
}

// ── 주간 계획 저장 ──
async function saveWeeklyPlan(userId, analysis, goal) {
  const parsePrompt = `아래 주간 훈련 계획에서 요일별 훈련 종류만 추출해서 JSON으로 반환하세요.
훈련 종류는 인터벌/템포런/페이스주/롱런/LSD/이지런/트레일런/수영/자전거/휴식 중 하나로만 표현하세요.

${analysis}

반드시 아래 JSON 형식으로만 응답하세요:
{"mon":"","tue":"","wed":"","thu":"","fri":"휴식","sat":"","sun":""}`;

  try {
    const jsonStr = await callClaude(parsePrompt, 200);
    const clean = jsonStr.replace(/```json|```/g, '').trim();
    const plan = JSON.parse(clean);
    const weekStart = getWeekStart();
    await sbUpsert('weekly_plans', {
      user_id: userId, week_start: weekStart,
      mon: plan.mon || '', tue: plan.tue || '', wed: plan.wed || '',
      thu: plan.thu || '', fri: plan.fri || '휴식',
      sat: plan.sat || '', sun: plan.sun || ''
    }, 'user_id,week_start');
  } catch (e) {
    console.error('Weekly plan parse error:', e);
  }
}

// ══════════════════════════════════════
// 월간 분석 (4000자 이내)
// ══════════════════════════════════════
async function analyzeMonthly(userId, goal, accessToken) {
  const targetPace = goal?.target_pace || '5:27';
  const trainingPhase = getTrainingPhase(goal?.race_date);
  const daysLeft = goal?.race_date ? Math.ceil((new Date(goal.race_date) - new Date()) / 86400000) : null;

  const lastMonthStart = Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60;
  const lastMonthEnd = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  const lastMonthRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${lastMonthStart}&before=${lastMonthEnd}&per_page=30`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  ).then(r => r.json());

  const lastMonthActs = Array.isArray(lastMonthRes) ? lastMonthRes : [];
  const lastMonthKm = (lastMonthActs.reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);

  // 운동 종류별 집계
  const sportCounts = {};
  const sportKm = {};
  lastMonthActs.forEach(a => {
    const st = getSportType(a);
    const wt = classifyWorkout(a, targetPace, st);
    const key = `${st}/${wt}`;
    sportCounts[key] = (sportCounts[key] || 0) + 1;
    sportKm[key] = (sportKm[key] || 0) + a.distance / 1000;
  });

  const sportSummary = Object.entries(sportCounts)
    .map(([k, v]) => `${k}: ${v}회 (${sportKm[k].toFixed(1)}km)`)
    .join('\n');

  const prompt = `마라톤 전문 코치로서 월간 종합 리포트를 작성하세요.

선수: ${goal?.race_name || '마라톤'} ${goal?.target_time || ''} (${targetPace}/km) | D-${daysLeft || '?'} | ${trainingPhase}
PR: 풀 ${goal?.pr_full || '-'} / 하프 ${goal?.pr_half || '-'} / 10K ${goal?.pr_10k || '-'}
훈련 페이스: 인터벌 ${calcPaceOffset(targetPace,30)} | 템포 ${calcPaceOffset(targetPace,15)} | LSD ${calcPaceOffset(targetPace,-60)} | 회복 ${calcPaceOffset(targetPace,-40)}

지난 달:
- 총 거리: ${lastMonthKm}km | 총 ${lastMonthActs.length}회
- 운동 구성:
${sportSummary}

4000자 이내로 작성:

## 지난 달 종합 평가

**훈련량 분석**
(달성률, 러닝/크로스트레이닝 비율, 강점/약점 3-4문장)

**훈련 질 분석**
(페이스 트렌드, 종류 구성 적절성, 트레일런/크로스트레이닝 마라톤 기여도 2-3문장)

**현재 목표 달성 가능성: X%**
(솔직한 평가 2문장)

---

## 다음 달 훈련 로드맵

**다음 달 목표**
- 월간 목표 거리: Xkm
- 핵심 목표: (3가지)

**주차별 계획**
1주차 (Xkm): 핵심훈련 [구체적 훈련/페이스/거리]
2주차 (Xkm): 핵심훈련 [구체적 훈련/페이스/거리]
3주차 (Xkm): 핵심훈련 [구체적 훈련/페이스/거리]
4주차 (Xkm): 핵심훈련 [회복 위주]

**레이스까지 월별 로드맵**
(각 월의 핵심 훈련 테마)

**다음 달 미션 완료 시 달성 가능성: X%**
(상승 근거 2-3문장)

**코치 한마디**
(동기부여 1-2문장)`;

  return callClaude(prompt, 3500);
}

// ══════════════════════════════════════
// 트라이애슬론 일일 분석
// ══════════════════════════════════════
async function analyzeTriathlonDaily(activities, goal, recentActivities) {
  const targetPace = goal?.target_pace || '5:27';
  const triType = goal?.tri_type || 'full';
  const triTypeLabel = triType === 'olympic' ? '올림픽' : triType === 'half' ? '하프 아이언맨' : '풀 아이언맨';
  const daysLeft = goal?.race_date ? Math.ceil((new Date(goal.race_date) - new Date()) / 86400000) : null;

  // 오늘 운동들 요약
  const todaySummary = activities.map(a => {
    const st = getSportType(a);
    const km = (a.distance / 1000).toFixed(1);
    const pace = calcPace(a.moving_time, a.distance);
    const hrs = Math.floor(a.moving_time / 3600);
    const mins = Math.floor((a.moving_time % 3600) / 60);
    const timeStr = hrs > 0 ? `${hrs}시간 ${mins}분` : `${mins}분`;

    if (st === '수영') return `🏊 수영 ${km}km (${timeStr})`;
    if (st === '자전거') return `🚴 자전거 ${km}km @ ${pace}/km (${timeStr})`;
    return `🏃 러닝 ${km}km @ ${pace}/km (${timeStr})`;
  }).join('\n');

  // 총 훈련 시간
  const totalMins = Math.floor(activities.reduce((s, a) => s + a.moving_time, 0) / 60);
  const runActs = activities.filter(a => getSportType(a) === '러닝' || getSportType(a) === '트레일런');
  const swimActs = activities.filter(a => getSportType(a) === '수영');
  const bikeActs = activities.filter(a => getSportType(a) === '자전거');

  // 벽돌훈련 감지 (자전거 + 러닝 같은 날)
  const isBrick = bikeActs.length > 0 && runActs.length > 0;

  const prompt = `트라이애슬론 전문 코치로서 오늘 훈련을 분석하세요.

선수 목표:
- 마라톤: ${goal?.target_time || '--'} (페이스 ${targetPace}/km)
- 트라이애슬론: ${triTypeLabel} ${goal?.tri_total_target || '완주'}
- D-${daysLeft || '?'}
- PR: 풀마라톤 ${goal?.pr_full || '-'} / 트라이애슬론 ${goal?.pr_10k || '-'}

오늘 훈련 (총 ${totalMins}분):
${todaySummary}
${isBrick ? '⚡ 벽돌훈련 감지 (자전거→러닝)' : ''}

최근 활동: ${recentActivities.slice(0,3).map(a => `${getSportType(a)} ${(a.distance/1000).toFixed(1)}km`).join(', ') || '없음'}

트라이애슬론 목표 기준:
- 수영 목표: ${goal?.tri_swim_target || '-'}
- 자전거 목표: ${goal?.tri_bike_target || '-'}
- 러닝 목표: ${goal?.tri_run_target || '-'}

1000자 이내로 작성:

**오늘 훈련 평가**
${isBrick ? '벽돌훈련 효과와 자전거→러닝 전환 품질 평가' : '각 종목별 강도와 품질 평가'}
수영/자전거가 마라톤 러닝 능력에 미치는 긍정적 영향 언급

**종목별 피드백**
(오늘 한 종목들에 대한 구체적 피드백)

**내일/이번 주 권장 훈련**
(종목 균형과 회복을 고려한 처방)`;

  return callClaude(prompt, 800);
}

// ══════════════════════════════════════
// 트라이애슬론 주간 분석
// ══════════════════════════════════════
async function analyzeWeeklyTriathlon(userId, goal, accessToken) {
  const targetPace = goal?.target_pace || '5:27';
  const triType = goal?.tri_type || 'full';
  const triTypeLabel = triType === 'olympic' ? '올림픽' : triType === 'half' ? '하프 아이언맨' : '풀 아이언맨';
  const daysLeft = goal?.race_date ? Math.ceil((new Date(goal.race_date) - new Date()) / 86400000) : null;

  const lastWeekStart = Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60;
  const lastWeekEnd = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const lastWeekRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${lastWeekStart}&before=${lastWeekEnd}&per_page=30`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  ).then(r => r.json());

  const lastWeekActs = Array.isArray(lastWeekRes) ? lastWeekRes : [];

  // 종목별 집계
  const swimKm = (lastWeekActs.filter(a => getSportType(a) === '수영').reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);
  const bikeKm = (lastWeekActs.filter(a => getSportType(a) === '자전거').reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);
  const runKm = (lastWeekActs.filter(a => ['러닝','트레일런'].includes(getSportType(a))).reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);
  const totalMins = Math.floor(lastWeekActs.reduce((s, a) => s + a.moving_time, 0) / 60);
  const brickSessions = lastWeekActs.filter(a => getSportType(a) === '자전거').length;

  const lastWeekSummary = lastWeekActs.map(a => {
    const st = getSportType(a);
    return `- [${st}] ${(a.distance/1000).toFixed(1)}km / ${Math.floor(a.moving_time/60)}분`;
  }).join('\n') || '기록 없음';

  const prompt = `트라이애슬론 전문 코치로서 주간 리포트를 작성하세요.

선수 목표:
- 마라톤: ${goal?.target_time || '--'} (페이스 ${targetPace}/km)
- 트라이애슬론: ${triTypeLabel} ${goal?.tri_total_target || '완주'} | D-${daysLeft || '?'}
- 수영목표 ${goal?.tri_swim_target || '-'} / 자전거목표 ${goal?.tri_bike_target || '-'} / 러닝목표 ${goal?.tri_run_target || '-'}

지난 주 훈련:
- 수영: ${swimKm}km | 자전거: ${bikeKm}km | 러닝: ${runKm}km
- 총 훈련시간: ${Math.floor(totalMins/60)}시간 ${totalMins%60}분
- 벽돌훈련: ${brickSessions}회
${lastWeekSummary}

2000자 이내로 작성:

**지난 주 평가**
(종목별 볼륨 평가, 균형 분석, 수영/자전거의 마라톤 기여도 3-4문장)

**다음 주 훈련 계획**

| 요일 | 훈련 | 거리/시간 | 강도 |
|------|------|---------|------|
| 월 | | | |
| 화 | | | |
| 수 | | | |
| 목 | | | |
| 금 | 휴식 | - | - |
| 토 | 벽돌훈련(자전거+러닝) | | |
| 일 | | | |

**핵심 훈련 상세**
1. [벽돌훈련 - 자전거 거리/강도 → 러닝 거리/페이스]
2. [장거리 수영 or 자전거]
3. [마라톤 페이스런]

**이번 주 핵심 포인트**
(트라이애슬론과 마라톤 병행 관련 2-3가지)`;

  const analysis = await callClaude(prompt, 1800);
  await saveWeeklyPlan(userId, analysis, goal);
  return analysis;
}

// ── 오늘 같은 날 활동 묶기 ──
function groupActivitiesByDay(activities) {
  const groups = {};
  activities.forEach(a => {
    const day = a.start_date.split('T')[0];
    if (!groups[day]) groups[day] = [];
    groups[day].push(a);
  });
  return groups;
}
export default async function handler(req, res) {
  const userId = req.query.user_id || req.body?.user_id;
  const type = req.query.type || 'daily';

  if (!userId) return res.status(400).json({ error: 'user_id required' });

  // ── 인증 체크 ──
  // 1. Cron/내부 호출: CRON_SECRET 또는 webhook 헤더
  // 2. 브라우저 직접 호출: Supabase JWT 검증
  const authHeader = req.headers.authorization || '';
  const isInternalCall = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isWebhookCall = req.headers['x-strava-webhook'] === process.env.STRAVA_VERIFY_TOKEN;

  if (!isInternalCall && !isWebhookCall) {
    // JWT 검증
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

      // JWT의 user_id와 요청 user_id 일치 여부 확인
      if (!userData?.id || userData.id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  try {
    const profiles = await sbGet('profiles', `id=eq.${userId}`);
    const profile = profiles[0];
    if (!profile?.strava_access_token) return res.status(400).json({ error: 'Strava not connected' });

    const goals = await sbGet('goals', `user_id=eq.${userId}&order=created_at.desc&limit=1`);
    const goal = goals[0];
    const accessToken = await refreshToken(profile, userId);

    // 주간 분석 (목표 타입에 따라 분기)
    if (type === 'weekly') {
      const isTri = goal?.goal_type === 'both' || goal?.goal_type === 'triathlon';
      const analysis = isTri
        ? await analyzeWeeklyTriathlon(userId, goal, accessToken)
        : await analyzeWeekly(userId, goal, accessToken);
      await sbPost('reports', { user_id: userId, type: 'weekly', content: analysis });
      const title = isTri ? '🏊🚴🏃 <b>트라이애슬론 주간 리포트</b>' : '📅 <b>주간 훈련 리포트</b>';
      await sendTelegram(profile.telegram_chat_id, title, analysis);
      return res.json({ success: true, type: 'weekly' });
    }

    // 월간 분석
    if (type === 'monthly') {
      const analysis = await analyzeMonthly(userId, goal, accessToken);
      await sbPost('reports', { user_id: userId, type: 'monthly', content: analysis });
      await sendTelegram(profile.telegram_chat_id, '📊 <b>월간 훈련 리포트</b>', analysis);
      return res.json({ success: true, type: 'monthly' });
    }

    // 일일 분석
    const activityId = req.query.activity_id;
    let activities = [];

    if (activityId) {
      const actRes = await fetch(
        `https://www.strava.com/api/v3/activities/${activityId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const act = await actRes.json();
      if (act.id) activities = [act];
    } else {
      const after = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
      const r = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=20`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      activities = await r.json();
    }

    if (!Array.isArray(activities) || activities.length === 0) {
      return res.json({ message: 'No new activities', synced: 0 });
    }

    const recentSaved = await sbGet('activities', `user_id=eq.${userId}&order=start_date.desc&limit=7`);
    const targetPace = goal?.target_pace || '5:27';
    const isTri = goal?.goal_type === 'both' || goal?.goal_type === 'triathlon';

    let newCount = 0;

    if (isTri) {
      // 트라이애슬론: 같은 날 활동 묶어서 분석
      const todayGroups = groupActivitiesByDay(activities);

      for (const [day, dayActs] of Object.entries(todayGroups)) {
        // 이미 저장된 활동 필터
        const newDayActs = [];
        for (const activity of dayActs) {
          const existing = await sbGet('activities', `strava_id=eq.${activity.id}&user_id=eq.${userId}`);
          if (existing.length > 0) continue;
          newDayActs.push(activity);
        }
        if (newDayActs.length === 0) continue;

        // 각 활동 저장
        for (const activity of newDayActs) {
          const sportType = getSportType(activity);
          const workoutType = classifyWorkout(activity, targetPace, sportType);
          const weekStart = getWeekStart(activity.start_date);
          const adjustedPace = sportType === '트레일런'
            ? calcAdjustedPace(activity.moving_time, activity.distance, activity.total_elevation_gain)
            : null;
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
            analysis: null // 묶음 분석으로 대체
          });
        }

        // 당일 전체 활동 묶어서 분석
        const allDayActs = [...newDayActs]; // 새 활동들
        const analysis = await analyzeTriathlonDaily(allDayActs, goal, recentSaved.slice(0, 6));

        // 분석 결과를 첫 번째 활동에만 저장
        const firstAct = newDayActs[0];
        await sbPatch('activities', `strava_id=eq.${firstAct.id}&user_id=eq.${userId}`, { analysis });

        // 텔레그램 발송
        const sports = [...new Set(allDayActs.map(a => getSportType(a)))];
        const sportIcons = sports.map(s => s === '수영' ? '🏊' : s === '자전거' ? '🚴' : '🏃').join('');
        const totalKm = (allDayActs.reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);
        const totalMins = Math.floor(allDayActs.reduce((s, a) => s + a.moving_time, 0) / 60);
        const isBrick = sports.includes('자전거') && sports.includes('러닝');

        const title = `${sportIcons} <b>${isBrick ? '벽돌훈련' : '복합훈련'}</b>\n📏 총 ${totalKm}km | ⏱ ${Math.floor(totalMins/60)}시간 ${totalMins%60}분`;
        await sendTelegram(profile.telegram_chat_id, title, analysis);
        newCount += newDayActs.length;
      }

    } else {
      // 마라톤: 개별 활동 분석
      for (const activity of activities) {
        const existing = await sbGet('activities', `strava_id=eq.${activity.id}&user_id=eq.${userId}`);
        if (existing.length > 0) continue;

        const sportType = getSportType(activity);
        const workoutType = classifyWorkout(activity, targetPace, sportType);
        const weekStart = getWeekStart(activity.start_date);
        const adjustedPace = sportType === '트레일런'
          ? calcAdjustedPace(activity.moving_time, activity.distance, activity.total_elevation_gain)
          : null;

        const details = await fetchActivityDetails(activity.id, accessToken);
        const phases = analyzePhases(details.laps, targetPace);

        const hrData = details.streams?.heartrate?.data || [];
        const cadData = details.streams?.cadence?.data || [];
        const avgHR = hrData.length > 0 ? Math.round(hrData.reduce((s, v) => s + v, 0) / hrData.length) : null;
        const avgCad = cadData.length > 0 ? Math.round(cadData.reduce((s, v) => s + v, 0) / cadData.length * 2) : null;

        const analysis = await analyzeDailyActivity(
          activity, goal, recentSaved.slice(0, 6),
          workoutType, sportType, phases, details
        );

        const km = (activity.distance / 1000).toFixed(1);
        const pace = calcPace(activity.moving_time, activity.distance);

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
          warmup_km: phases ? parseFloat(phases.warmupKm) : null,
          main_km: phases ? parseFloat(phases.mainKm) : null,
          cooldown_km: phases ? parseFloat(phases.cooldownKm) : null,
          analysis
        });

        const sportIcon = sportType === '트레일런' ? '🏔️' : sportType === '자전거' ? '🚴' : sportType === '수영' ? '🏊' : '🏃';
        const title = `${sportIcon} <b>${activity.name}</b> [${workoutType}]\n📏 ${km}km | ⚡ ${pace}/km${adjustedPace ? ` (환산 ${adjustedPace}/km)` : ''}${avgHR ? ` | ❤️ ${avgHR}bpm` : ''}`;
        await sendTelegram(profile.telegram_chat_id, title, analysis);
        newCount++;
      }
    }

    res.json({ success: true, synced: newCount });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: error.message });
  }
}
