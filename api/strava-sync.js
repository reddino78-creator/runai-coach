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

// ── 훈련 종류 자동 분류 ──
function classifyWorkout(activity, targetPace) {
  const km = activity.distance / 1000;
  const pace = calcPace(activity.moving_time, activity.distance);
  const paceSec = paceToSec(pace);
  const targetSec = paceToSec(targetPace);
  const diff = paceSec - targetSec; // 양수 = 느림, 음수 = 빠름

  if (km < 3) return '이지런';
  if (diff <= -25 && km <= 12) return '인터벌';
  if (diff <= -10 && km <= 15) return '템포런';
  if (diff <= 10 && km >= 8) return '페이스주';
  if (km >= 20) return 'LSD';
  if (km >= 15) return '롱런';
  return '이지런';
}

// ── 주간 시작일 계산 (월요일 기준) ──
function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
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
async function analyzeDailyActivity(activity, goal, recentActivities, workoutType) {
  const km = (activity.distance / 1000).toFixed(1);
  const pace = calcPace(activity.moving_time, activity.distance);
  const targetPace = goal?.target_pace || '5:27';
  const trainingPhase = getTrainingPhase(goal?.race_date);
  const weeklyTarget = getWeeklyTarget(trainingPhase);
  const daysLeft = goal?.race_date ? Math.ceil((new Date(goal.race_date) - new Date()) / 86400000) : null;

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  const weekKm = (recentActivities
    .filter(a => new Date(a.start_date) >= weekStart)
    .reduce((s, a) => s + a.distance, 0) / 1000 + parseFloat(km)).toFixed(1);

  const prompt = `마라톤 코치로서 간결한 일일 분석을 작성하세요.

선수: ${goal?.race_name || '마라톤'} ${goal?.target_time || ''} (목표페이스 ${targetPace}/km) | D-${daysLeft || '?'} | ${trainingPhase}
PR: 풀 ${goal?.pr_full || '-'} / 하프 ${goal?.pr_half || '-'}

오늘: ${workoutType} ${km}km @ ${pace}/km | 고도 ${activity.total_elevation_gain || 0}m
이번 주: ${weekKm}km / ${weeklyTarget}km 목표
최근 활동: ${recentActivities.slice(0,3).map(a => `${(a.distance/1000).toFixed(1)}km@${calcPace(a.moving_time,a.distance)}`).join(', ') || '없음'}

훈련 페이스: 인터벌 ${calcPaceOffset(targetPace,30)} | 템포 ${calcPaceOffset(targetPace,15)} | LSD ${calcPaceOffset(targetPace,-60)} | 회복 ${calcPaceOffset(targetPace,-40)}

1000자 이내로 작성:

**오늘 평가**
(목표 페이스 대비 평가, 잘한 점/부족한 점 2문장)

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

  // 지난 주 활동
  const lastWeekStart = Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60;
  const lastWeekEnd = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const lastWeekRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${lastWeekStart}&before=${lastWeekEnd}&per_page=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  ).then(r => r.json());

  const lastWeekActs = Array.isArray(lastWeekRes) ? lastWeekRes : [];
  const lastWeekKm = (lastWeekActs.reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);
  const lastWeekSummary = lastWeekActs.map(a => {
    const wt = classifyWorkout(a, targetPace);
    return `- ${new Date(a.start_date).toLocaleDateString('ko-KR')} [${wt}] ${(a.distance/1000).toFixed(1)}km @ ${calcPace(a.moving_time,a.distance)}/km`;
  }).join('\n') || '기록 없음';

  const prompt = `마라톤 코치로서 주간 리포트를 작성하세요.

선수: ${goal?.race_name || '마라톤'} ${goal?.target_time || ''} (${targetPace}/km) | D-${daysLeft || '?'} | ${trainingPhase}
PR: 풀 ${goal?.pr_full || '-'} / 하프 ${goal?.pr_half || '-'}
훈련 페이스: 인터벌 ${calcPaceOffset(targetPace,30)} | 템포 ${calcPaceOffset(targetPace,15)} | LSD ${calcPaceOffset(targetPace,-60)} | 회복 ${calcPaceOffset(targetPace,-40)}

지난 주 기록 (총 ${lastWeekKm}km / 목표 ${weeklyTarget}km):
${lastWeekSummary}

2000자 이내로 작성:

**지난 주 평가**
(훈련량, 강도, 구성 평가 3-4문장)

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
1. [가장 중요한 훈련 - 구체적 세트/거리/페이스]
2. [두 번째 훈련 - 구체적 거리/페이스]

**이번 주 핵심 포인트**
(집중할 2-3가지)`;

  const analysis = await callClaude(prompt, 1800);

  // 주간 계획을 weekly_plans 테이블에 저장
  await saveWeeklyPlan(userId, analysis, goal);

  return analysis;
}

// ── 주간 계획 파싱 후 저장 ──
async function saveWeeklyPlan(userId, analysis, goal) {
  const targetPace = goal?.target_pace || '5:27';
  const trainingPhase = getTrainingPhase(goal?.race_date);

  // Claude에게 요일별 훈련을 JSON으로 추출 요청
  const parsePrompt = `아래 주간 훈련 계획에서 요일별 훈련 종류만 추출해서 JSON으로 반환하세요.
훈련 종류는 인터벌/템포런/페이스주/롱런/LSD/이지런/휴식 중 하나로만 표현하세요.

${analysis}

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{"mon":"","tue":"","wed":"","thu":"","fri":"","sat":"","sun":""}`;

  try {
    const jsonStr = await callClaude(parsePrompt, 200);
    const clean = jsonStr.replace(/```json|```/g, '').trim();
    const plan = JSON.parse(clean);
    const weekStart = getWeekStart();

    await sbUpsert('weekly_plans', {
      user_id: userId,
      week_start: weekStart,
      mon: plan.mon || '',
      tue: plan.tue || '',
      wed: plan.wed || '',
      thu: plan.thu || '',
      fri: plan.fri || '휴식',
      sat: plan.sat || '',
      sun: plan.sun || ''
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

  // 지난 달 활동
  const lastMonthStart = Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60;
  const lastMonthEnd = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  const lastMonthRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${lastMonthStart}&before=${lastMonthEnd}&per_page=30`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  ).then(r => r.json());

  const lastMonthActs = Array.isArray(lastMonthRes) ? lastMonthRes : [];
  const lastMonthKm = (lastMonthActs.reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);
  const avgPaceSec = lastMonthActs.length > 0
    ? lastMonthActs.reduce((s, a) => s + (a.moving_time / (a.distance / 1000)), 0) / lastMonthActs.length : 0;
  const avgPace = avgPaceSec > 0 ? `${Math.floor(avgPaceSec/60)}:${String(Math.round(avgPaceSec%60)).padStart(2,'0')}` : '-';

  // 훈련 종류별 분류
  const workoutCounts = { '인터벌': 0, '템포런': 0, '페이스주': 0, '롱런': 0, 'LSD': 0, '이지런': 0 };
  lastMonthActs.forEach(a => {
    const wt = classifyWorkout(a, targetPace);
    if (workoutCounts[wt] !== undefined) workoutCounts[wt]++;
  });

  const prompt = `마라톤 전문 코치로서 월간 종합 리포트를 작성하세요.

선수: ${goal?.race_name || '마라톤'} ${goal?.target_time || ''} (${targetPace}/km) | D-${daysLeft || '?'} | ${trainingPhase}
PR: 풀 ${goal?.pr_full || '-'} / 하프 ${goal?.pr_half || '-'} / 10K ${goal?.pr_10k || '-'}
훈련 페이스: 인터벌 ${calcPaceOffset(targetPace,30)} | 템포 ${calcPaceOffset(targetPace,15)} | LSD ${calcPaceOffset(targetPace,-60)} | 회복 ${calcPaceOffset(targetPace,-40)}

지난 달 데이터:
- 총 거리: ${lastMonthKm}km | 평균 페이스: ${avgPace}/km | 총 ${lastMonthActs.length}회
- 훈련 구성: 인터벌 ${workoutCounts['인터벌']}회 / 템포 ${workoutCounts['템포런']}회 / 페이스주 ${workoutCounts['페이스주']}회 / 롱런 ${workoutCounts['롱런']}회 / LSD ${workoutCounts['LSD']}회 / 이지런 ${workoutCounts['이지런']}회

4000자 이내로 작성:

## 지난 달 종합 평가

**훈련량 분석**
(달성률, 주간 평균, 강점/약점 3-4문장)

**훈련 질 분석**
(페이스 트렌드, 훈련 구성 적절성 2-3문장)

**현재 목표 달성 가능성: X%**
(솔직한 평가 2문장)

---

## 다음 달 훈련 로드맵

**다음 달 목표**
- 월간 목표 거리: Xkm
- 핵심 목표: (3가지)

**주차별 계획**

1주차 (Xkm): 핵심훈련 - [구체적 훈련/페이스/거리]
2주차 (Xkm): 핵심훈련 - [구체적 훈련/페이스/거리]
3주차 (Xkm): 핵심훈련 - [구체적 훈련/페이스/거리]
4주차 (Xkm): 핵심훈련 - [회복 위주]

**레이스까지 월별 로드맵**
(현재부터 레이스까지 각 월의 핵심 훈련 테마)

**다음 달 미션 완료 시 달성 가능성: X%**
(미션 완료 시 가능성 상승 근거 2-3문장)

**코치 한마디**
(동기부여 메시지 1-2문장)`;

  return callClaude(prompt, 3500);
}

// ══════════════════════════════════════
// 메인 핸들러
// ══════════════════════════════════════
export default async function handler(req, res) {
  const userId = req.query.user_id || req.body?.user_id;
  const type = req.query.type || 'daily';

  if (!userId) return res.status(400).json({ error: 'user_id required' });

  try {
    const profiles = await sbGet('profiles', `id=eq.${userId}`);
    const profile = profiles[0];
    if (!profile?.strava_access_token) return res.status(400).json({ error: 'Strava not connected' });

    const goals = await sbGet('goals', `user_id=eq.${userId}&order=created_at.desc&limit=1`);
    const goal = goals[0];

    const accessToken = await refreshToken(profile, userId);

    // 주간 분석
    if (type === 'weekly') {
      const analysis = await analyzeWeekly(userId, goal, accessToken);
      // Supabase에 저장
      await sbPost('reports', {
        user_id: userId,
        type: 'weekly',
        content: analysis
      });
      await sendTelegram(profile.telegram_chat_id, '📅 <b>주간 훈련 리포트</b>', analysis);
      return res.json({ success: true, type: 'weekly' });
    }

    // 월간 분석
    if (type === 'monthly') {
      const analysis = await analyzeMonthly(userId, goal, accessToken);
      // Supabase에 저장
      await sbPost('reports', {
        user_id: userId,
        type: 'monthly',
        content: analysis
      });
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

    let newCount = 0;
    for (const activity of activities) {
      const existing = await sbGet('activities', `strava_id=eq.${activity.id}&user_id=eq.${userId}`);
      if (existing.length > 0) continue;

      const targetPace = goal?.target_pace || '5:27';
      const workoutType = classifyWorkout(activity, targetPace);
      const weekStart = getWeekStart(activity.start_date);
      const analysis = await analyzeDailyActivity(activity, goal, recentSaved.slice(0, 6), workoutType);
      const km = (activity.distance / 1000).toFixed(1);
      const pace = calcPace(activity.moving_time, activity.distance);

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
        calories: activity.calories,
        start_date: activity.start_date,
        analysis
      });

      const title = `🏃 <b>${activity.name}</b> [${workoutType}]\n📏 ${km}km | ⚡ ${pace}/km`;
      await sendTelegram(profile.telegram_chat_id, title, analysis);
      newCount++;
    }

    res.json({ success: true, synced: newCount });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: error.message });
  }
}
