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

// ── 언덕 강도 분류 ──
function classifyHill(distance, elevation) {
  if (!distance || distance === 0) return null;
  const elevPerKm = (elevation || 0) / (distance / 1000);
  if (elevPerKm < 5)  return null;
  if (elevPerKm < 15) return { level: '저강도 언덕', desc: '살짝 굴곡 있음', icon: '🏃', elevPerKm };
  if (elevPerKm < 25) return { level: '중강도 언덕', desc: '업다운이 계속 느껴짐', icon: '⛰️', elevPerKm };
  if (elevPerKm < 40) return { level: '고강도 언덕', desc: '페이스 유지가 부담됨', icon: '🏔️', elevPerKm };
  return { level: '매우 고강도 언덕', desc: '트레일/산악 느낌', icon: '🗻', elevPerKm };
}

// ── 훈련 종류 자동 분류 ──
function classifyWorkout(activity, targetPace, sportType) {
  if (isCrossTraining(sportType)) return sportType;

  const km = activity.distance / 1000;
  const elevation = activity.total_elevation_gain || 0;

  if (sportType !== '트레일런') {
    const hill = classifyHill(activity.distance, elevation);
    if (hill && hill.elevPerKm >= 15) return '언덕훈련';
  }

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

// ── 주간 시작일 (월요일 기준) ──
function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=일, 1=월 ... 6=토
  // 일요일(0)은 -6, 월요일(1)은 0, 화요일(2)은 -1 ... 토요일(6)은 -5
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── 날짜 컨텍스트 계산 (오늘 기준) ──
function getDateContext() {
  const KST_OFFSET = 9 * 60 * 60 * 1000;
  const now = new Date(Date.now() + KST_OFFSET);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dayNamesEn = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const todayDow = now.getUTCDay(); // 0=일~6=토 (KST 기준)

  // 이번 주 월요일
  const weekMonday = new Date(now);
  const diffToMon = todayDow === 0 ? -6 : 1 - todayDow;
  weekMonday.setUTCDate(weekMonday.getUTCDate() + diffToMon);
  weekMonday.setUTCHours(0, 0, 0, 0);

  // 이번 주 일요일
  const weekSunday = new Date(weekMonday);
  weekSunday.setUTCDate(weekMonday.getUTCDate() + 6);

  // 이번 주 몇 번째 날 (월=1, 화=2 ... 일=7)
  const weekDayNum = todayDow === 0 ? 7 : todayDow;

  // 남은 요일 목록 (오늘 포함 X, 일요일까지)
  const remainingDays = [];
  for (let i = todayDow + 1; i <= 7; i++) {
    const dow = i === 7 ? 0 : i;
    remainingDays.push(dayNames[dow]);
  }

  // 월간: 이번 달 1일 ~ 말일
  const monthStart = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const monthEnd   = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0);

  // 이번 달 몇 주차
  const weekOfMonth = Math.ceil(now.getUTCDate() / 7);

  const fmt = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;

  return {
    today: fmt(now),
    todayLabel: `${now.getUTCMonth()+1}월 ${now.getUTCDate()}일 (${dayNames[todayDow]})`,
    todayDow,
    todayDowName: dayNames[todayDow],
    weekDayNum,            // 주의 몇 번째 날 (1~7)
    weekStart: fmt(weekMonday),
    weekEnd:   fmt(weekSunday),
    weekRange: `${now.getUTCMonth()+1}월 ${weekMonday.getUTCDate()}일(월) ~ ${weekSunday.getUTCMonth()+1}월 ${weekSunday.getUTCDate()}일(일)`,
    remainingDays,         // 남은 요일 한글 배열 (오늘 제외)
    remainingDaysCount: remainingDays.length,
    hasSundayLeft: remainingDays.includes('일'),
    monthStart: fmt(monthStart),
    monthEnd:   fmt(monthEnd),
    monthLabel: `${now.getUTCMonth()+1}월`,
    weekOfMonth,
    nowTs: Math.floor((Date.now()) / 1000)  // UTC 타임스탬프 (Strava API용)
  };
}

// ── 날씨 데이터 가져오기 ──
async function fetchWeather(lat, lng, activityDate) {
  try {
    if (!lat || !lng || !process.env.OPENWEATHER_API_KEY) return null;

    const date = new Date(activityDate);
    const now = new Date();
    const diffHours = (now - date) / (1000 * 60 * 60);

    let url;
    if (diffHours < 48) {
      // 최근 48시간: 현재 날씨
      url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric&lang=kr`;
    } else {
      return null; // 과거 날씨는 유료
    }

    const res = await fetch(url);
    const data = await res.json();

    if (data.main) {
      return {
        temp: Math.round(data.main.temp),
        feels_like: Math.round(data.main.feels_like),
        humidity: data.main.humidity,
        weather: data.weather?.[0]?.description || '',
        wind_speed: data.wind?.speed || 0,
        is_rain: data.rain != null || (data.weather?.[0]?.main === 'Rain'),
        is_snow: data.snow != null || (data.weather?.[0]?.main === 'Snow')
      };
    }
    return null;
  } catch(e) {
    console.error('Weather fetch error:', e);
    return null;
  }
}

// ── 날씨 영향 분석 ──
function analyzeWeatherImpact(weather) {
  if (!weather) return null;
  const impacts = [];

  // 기온
  if (weather.temp >= 30) impacts.push(`🌡️ 고온(${weather.temp}°C) - 페이스 5~10% 저하, 심박 상승 예상`);
  else if (weather.temp >= 25) impacts.push(`🌡️ 고온(${weather.temp}°C) - 체감온도 ${weather.feels_like}°C, 수분 보충 필수`);
  else if (weather.temp <= 0) impacts.push(`🥶 영하(${weather.temp}°C) - 준비운동 충분히, 근육 경직 주의`);
  else if (weather.temp <= 5) impacts.push(`❄️ 한랭(${weather.temp}°C) - 워밍업 10분 이상 권장`);
  else if (weather.temp >= 15 && weather.temp <= 22) impacts.push(`✅ 최적 기온(${weather.temp}°C) - 최상의 러닝 컨디션`);

  // 습도
  if (weather.humidity >= 80) impacts.push(`💧 고습도(${weather.humidity}%) - 체감온도 높음, 탈수 주의`);

  // 강수
  if (weather.is_rain) impacts.push(`🌧️ 강우 - 미끄럼 주의, 페이스 조절 필요`);
  if (weather.is_snow) impacts.push(`❄️ 강설 - 안전 최우선, 강도 낮추기 권장`);

  // 바람
  if (weather.wind_speed >= 10) impacts.push(`💨 강풍(${weather.wind_speed}m/s) - 역풍 구간 페이스 손실 고려`);

  return impacts.length > 0 ? impacts.join('\n') : `🌤️ ${weather.temp}°C, 날씨 양호`;
}

// ── 컨디션 가져오기 ──
async function fetchUserCondition(userId, activityDate) {
  try {
    const date = activityDate.split('T')[0];
    const conditions = await sbGet('conditions',
      `user_id=eq.${userId}&date=eq.${date}&select=condition,injury_part,injury_level,memo`
    );
    return conditions?.[0] || null;
  } catch(e) {
    return null;
  }
}
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

// ── 토큰 갱신 (공용 키 사용) ──
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
// 일일 분석 (1000자 이내) — A1+S3 통합
// ══════════════════════════════════════
async function analyzeDailyActivity(activity, goal, recentActivities, workoutType, sportType, phases, details, weather, condition, coachingNote, currentFitnessPace) {
  const km = (activity.distance / 1000).toFixed(1);
  const pace = calcPace(activity.moving_time, activity.distance);
  const targetPace = goal?.target_pace || '5:27';
  const trainingPhase = getTrainingPhase(goal?.race_date);
  const weeklyTarget = getWeeklyTarget(trainingPhase);
  const daysLeft = goal?.race_date ? Math.ceil((new Date(goal.race_date) - new Date()) / 86400000) : null;
  const isCross = isCrossTraining(sportType);
  const isTrail = sportType === '트레일런';
  const adjustedPace = isTrail ? calcAdjustedPace(activity.moving_time, activity.distance, activity.total_elevation_gain) : pace;

  const ctx = getDateContext();
  const weekKm = (recentActivities
    .filter(a => a.start_date >= ctx.weekStart)
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

  // 날씨 영향 분석
  const weatherImpact = weather ? analyzeWeatherImpact(weather) : null;

  // 컨디션 정보
  const conditionInfo = condition ? `
컨디션: ${condition.condition || '보통'}
부상: ${condition.injury_part || '없음'}${condition.injury_part && condition.injury_part !== '없음' ? ` (${condition.injury_level})` : ''}
${condition.memo ? `메모: ${condition.memo}` : ''}` : '';

  // S3: 페이스 갭 계산
  const targetSec = paceToSec(targetPace);
  const fitnessSec = currentFitnessPace ? paceToSec(currentFitnessPace) : null;
  const paceGapSec = fitnessSec ? fitnessSec - targetSec : null;

  const prompt = `마라톤 코치로서 간결한 일일 분석을 작성하세요.

📅 오늘: ${ctx.todayLabel} | 이번 주 ${ctx.weekDayNum}일차 | 이번 주: ${ctx.weekRange}
남은 요일: ${ctx.remainingDaysCount > 0 ? ctx.remainingDays.join(', ') : '없음 (오늘이 일요일)'}${ctx.hasSundayLeft ? ' (일요일: 일산호수 LSD 고정)' : ''}
${coachingNote ? `\n📝 최근 코치 조언: ${coachingNote}\n` : ''}
선수: ${goal?.race_name || '마라톤'} ${goal?.target_time || ''} (목표페이스 ${targetPace}/km) | D-${daysLeft || '?'} | ${trainingPhase}
PR: 풀 ${goal?.pr_full || '-'} / 하프 ${goal?.pr_half || '-'}
${currentFitnessPace ? `현재 체력 추정 페이스: ${currentFitnessPace}/km (목표 대비 ${(paceGapSec||0) > 0 ? '+' + paceGapSec : paceGapSec}초/km)` : ''}

오늘 운동:
- 종류: ${sportType} [${workoutType}]
- 거리: ${km}km | 시간: ${Math.floor(activity.moving_time / 60)}분
- 페이스: ${pace}/km ${isTrail ? `(고도 환산: ${adjustedPace}/km)` : ''}
- 고도: ${activity.total_elevation_gain || 0}m
${avgHR ? `- 평균 심박수: ${avgHR}bpm` : ''}
${avgCad ? `- 케이던스: ${avgCad}spm (권장: 170~180spm)` : ''}
- 구간: ${phaseInfo}
${weatherImpact ? `\n날씨 환경:\n${weatherImpact}` : ''}
${conditionInfo ? `\n선수 컨디션:${conditionInfo}` : ''}

이번 주: ${weekKm}km / ${weeklyTarget}km 목표
최근 활동: ${recentActivities.slice(0,3).map(a => `${getSportType(a)} ${(a.distance/1000).toFixed(1)}km@${calcPace(a.moving_time,a.distance)}`).join(', ') || '없음'}

훈련 페이스: 인터벌 ${calcPaceOffset(targetPace,30)} | 템포 ${calcPaceOffset(targetPace,15)} | LSD ${calcPaceOffset(targetPace,-60)} | 회복 ${calcPaceOffset(targetPace,-40)}

1000자 이내로 작성:

**오늘 평가**
${isCross ? '크로스트레이닝 관점에서 마라톤 훈련에 미치는 영향 평가' : isTrail ? '트레일런 강도를 고도 환산 페이스 기준으로 평가' : '목표 페이스 대비 평가, 웜업/주훈련/쿨다운 구성 평가'}
${avgHR ? '심박수 기반 강도 평가 포함' : ''}
${avgCad ? '케이던스 평가 및 개선 방향 포함' : ''}
${weatherImpact ? '날씨가 페이스/심박에 미친 영향 분석 포함' : ''}
${condition?.injury_part && condition.injury_part !== '없음' ? `⚠️ ${condition.injury_part} 부상(${condition.injury_level}) 고려한 조언 포함` : ''}
${condition?.condition === '피로' ? '⚠️ 피로 컨디션 고려한 회복 조언 포함' : ''}

**이번 주 영향**
(주간 목표 달성에 미치는 영향 1문장)

**남은 훈련 처방**
남은 요일(${ctx.remainingDaysCount > 0 ? ctx.remainingDays.join('/') : '없음'})에 맞춰 구체적 훈련을 처방하세요.${ctx.hasSundayLeft ? '\n- 일요일은 일산호수마라톤 일요정모 LSD(장거리 조깅)가 고정입니다. 반드시 포함하세요.' : ''}${condition?.injury_part && condition.injury_part !== '없음' ? '\n- 부상 고려한 처방 필수' : ''}
각 훈련마다 날짜(요일), 거리, 페이스를 명시하세요.`;

  return callClaude(prompt, 800);
}

// ══════════════════════════════════════
// 주간 분석 (2000자 이내) — S2+S3+S5+A1 통합
// ══════════════════════════════════════
async function analyzeWeekly(userId, goal, accessToken) {
  const targetPace = goal?.target_pace || '5:27';
  const trainingPhase = getTrainingPhase(goal?.race_date);
  const weeklyTarget = getWeeklyTarget(trainingPhase);
  const daysLeft = goal?.race_date ? Math.ceil((new Date(goal.race_date) - new Date()) / 86400000) : null;
  const ctx = getDateContext();

  // 이번 주 (월요일 00:00 KST ~ 현재)
  const thisWeekAfter = Math.floor(new Date(ctx.weekStart + 'T00:00:00+09:00').getTime() / 1000);
  const thisWeekRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${thisWeekAfter}&per_page=30`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  ).then(r => r.json());
  const thisWeekActs = Array.isArray(thisWeekRes) ? thisWeekRes : [];
  const thisWeekKm = (thisWeekActs.reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);

  // 지난 주 (저번 주 월요일 ~ 일요일)
  const lastWeekEnd   = thisWeekAfter;
  const lastWeekStart = lastWeekEnd - 7 * 24 * 60 * 60;
  const lastWeekRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${lastWeekStart}&before=${lastWeekEnd}&per_page=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  ).then(r => r.json());
  const lastWeekActs = Array.isArray(lastWeekRes) ? lastWeekRes : [];
  const lastWeekKm = (lastWeekActs.reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);

  // A1: 이전 주 코칭 메모 불러오기
  const prevCoachingNote = await fetchCoachingNote(userId, 'weekly');

  // S2: 계획 대비 실행 비교
  const planComparison = await fetchWeeklyPlanComparison(userId, ctx.weekStart, thisWeekActs, targetPace);

  // S3: 현재 체력 추정 페이스
  const currentFitnessPace = await calcCurrentFitnessPace(accessToken);
  const targetSec = paceToSec(targetPace);
  const fitnessSec = currentFitnessPace ? paceToSec(currentFitnessPace) : null;
  const paceGap = fitnessSec ? fitnessSec - targetSec : null; // 양수 = 목표보다 느림

  // S5: 주간 KPI
  const kpi = calcWeeklyKPI(thisWeekActs, weeklyTarget, targetPace);

  // 이번 주 훈련 요약
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const thisWeekSummary = thisWeekActs.map(a => {
    const st = getSportType(a);
    const wt = classifyWorkout(a, targetPace, st);
    const dow = dayNames[new Date(a.start_date).getDay()];
    return `- [${dow}] [${st}/${wt}] ${(a.distance/1000).toFixed(1)}km @ ${calcPace(a.moving_time,a.distance)}/km 고도${a.total_elevation_gain||0}m`;
  }).join('\n') || '이번 주 기록 없음';

  const lastWeekSummary = lastWeekActs.map(a => {
    const st = getSportType(a);
    const wt = classifyWorkout(a, targetPace, st);
    const adjustedPace = st === '트레일런'
      ? `(환산 ${calcAdjustedPace(a.moving_time, a.distance, a.total_elevation_gain)}/km)`
      : '';
    return `- [${st}/${wt}] ${(a.distance/1000).toFixed(1)}km @ ${calcPace(a.moving_time,a.distance)}/km ${adjustedPace} 고도${a.total_elevation_gain||0}m`;
  }).join('\n') || '기록 없음';

  const remainingStr = ctx.remainingDaysCount > 0
    ? `${ctx.remainingDays.join(', ')}${ctx.hasSundayLeft ? ' (일요일: 일산호수 LSD 고정)' : ''}`
    : '없음 (오늘이 일요일)';

  const prompt = `마라톤 코치로서 주간 리포트를 작성하세요.

📅 오늘: ${ctx.todayLabel} | 이번 주 ${ctx.weekDayNum}일차 | ${ctx.weekRange}
남은 요일: ${remainingStr}

선수: ${goal?.race_name || '마라톤'} ${goal?.target_time || ''} (목표페이스 ${targetPace}/km) | D-${daysLeft || '?'} | ${trainingPhase}
PR: 풀 ${goal?.pr_full || '-'} / 하프 ${goal?.pr_half || '-'}
훈련 페이스: 인터벌 ${calcPaceOffset(targetPace,30)} | 템포 ${calcPaceOffset(targetPace,15)} | LSD ${calcPaceOffset(targetPace,-60)} | 회복 ${calcPaceOffset(targetPace,-40)}

📊 이번 주 KPI:
${kpi.summary}${planComparison ? `\n계획 이행률: ${planComparison.completedCount}/${planComparison.totalCount} (${planComparison.rate}%)` : ''}

🏃 현재 체력 페이스: ${currentFitnessPace || '데이터 부족'}${paceGap !== null ? ` (목표 대비 ${paceGap > 0 ? '+' + paceGap : paceGap}초/km ${paceGap > 0 ? '느림' : '빠름'})` : ''}

${planComparison ? `📋 이번 주 계획 vs 실행 (월~${ctx.todayDowName}):\n${planComparison.text}\n` : ''}
이번 주 완료된 훈련 (월~${ctx.todayDowName}):
${thisWeekSummary}

지난 주 기록 (총 ${lastWeekKm}km / 목표 ${weeklyTarget}km):
${lastWeekSummary}
${prevCoachingNote ? `\n📝 지난 주 코치 핵심 조언 (follow-up 필요):\n${prevCoachingNote}\n` : ''}
2000자 이내로 작성:

**지난 주 평가**
(훈련량, 강도, 종류 구성 평가. ${prevCoachingNote ? '지난 주 코치 조언 이행 여부 반드시 언급.' : ''} 3-4문장)

**이번 주 현황 & 남은 훈련 처방**
오늘(${ctx.todayLabel})까지 ${thisWeekKm}km 완료 (목표 ${weeklyTarget}km의 ${kpi.distRate}%).${planComparison ? ` 계획 이행률 ${planComparison.rate}%.` : ''}
${currentFitnessPace ? `현재 체력 페이스 ${currentFitnessPace}/km — 목표까지 ${Math.abs(paceGap || 0)}초/km ${(paceGap||0) > 0 ? '개선' : '여유'} 필요.` : ''}
남은 요일(${ctx.remainingDays.join('/')})에 맞춰 처방:
${ctx.hasSundayLeft ? '- 일요일은 일산호수마라톤 일요정모 LSD 고정 (반드시 포함)' : ''}
각 요일별 훈련 종류, 거리, 페이스를 구체적으로 작성.

**다음 주 훈련 계획 (목표 ${weeklyTarget}km)**

| 요일 | 훈련 | 거리 | 페이스 |
|------|------|------|--------|
| 월 | | | |
| 화 | | | |
| 수 | | | |
| 목 | | | |
| 금 | 휴식 | - | - |
| 토 | | | |
| 일 | LSD (일산호수 일요정모) | | |

**핵심 훈련 상세**
1. [가장 중요한 훈련 - 웜업/주훈련/쿨다운 구간 포함]
2. [두 번째 훈련]

**이번 주 핵심 포인트**
(집중할 2-3가지 — 현재 체력 페이스 기반 구체적 개선 방향 포함)`;

  const analysis = await callClaude(prompt, 1800);

  // A1: 이번 주 코칭 노트 저장 (다음 주에 활용)
  await saveCoachingNote(userId, 'weekly', ctx.weekStart, analysis);
  await saveWeeklyPlan(userId, analysis, goal);
  return analysis;
}

// ── 주간 계획 저장 ──
async function saveWeeklyPlan(userId, analysis, goal) {
  const parsePrompt = `아래 주간 훈련 계획에서 요일별 훈련 종류만 추출해서 JSON으로 반환하세요.
훈련 종류는 인터벌/템포런/페이스주/롱런/LSD/이지런/트레일런/수영/자전거/휴식 중 하나로만 표현하세요.

${analysis.substring(0, 2000)}

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요:
{"mon":"","tue":"","wed":"","thu":"","fri":"휴식","sat":"","sun":""}`;

  try {
    const jsonStr = await callClaude(parsePrompt, 200);
    const clean = jsonStr.replace(/```json|```/g, '').replace(/[\n\r]/g, '').trim();
    const jsonMatch = clean.match(/\{[^}]+\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    const plan = JSON.parse(jsonMatch[0]);
    const weekStart = getWeekStart();
    await sbUpsert('weekly_plans', {
      user_id: userId, week_start: weekStart,
      mon: plan.mon || '', tue: plan.tue || '', wed: plan.wed || '',
      thu: plan.thu || '', fri: plan.fri || '휴식',
      sat: plan.sat || '', sun: plan.sun || ''
    }, 'user_id,week_start');
  } catch (e) {
    console.error('Weekly plan parse error:', e.message);
  }
}

// ══════════════════════════════════════
// 월간 분석 (4000자 이내)
// ══════════════════════════════════════
async function analyzeMonthly(userId, goal, accessToken) {
  const targetPace = goal?.target_pace || '5:27';
  const trainingPhase = getTrainingPhase(goal?.race_date);
  const daysLeft = goal?.race_date ? Math.ceil((new Date(goal.race_date) - new Date()) / 86400000) : null;
  const ctx = getDateContext();

  // 이번 달: 1일 00:00 KST ~ 현재
  const thisMonthAfter = Math.floor(new Date(ctx.monthStart + 'T00:00:00+09:00').getTime() / 1000);
  const thisMonthRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${thisMonthAfter}&per_page=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  ).then(r => r.json());
  const thisMonthActs = Array.isArray(thisMonthRes) ? thisMonthRes : [];
  const thisMonthKm = (thisMonthActs.reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);

  // 지난 달: 저번 달 1일 ~ 말일
  const lastMonthEnd   = thisMonthAfter;
  const prevMonthDate  = new Date(ctx.monthStart + 'T00:00:00+09:00');
  prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
  const lastMonthStart = Math.floor(prevMonthDate.getTime() / 1000);
  const lastMonthRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${lastMonthStart}&before=${lastMonthEnd}&per_page=30`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  ).then(r => r.json());

  const lastMonthActs = Array.isArray(lastMonthRes) ? lastMonthRes : [];
  const lastMonthKm = (lastMonthActs.reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);

  // 이번 달 운동 종류별 집계
  const sportCounts = {};
  const sportKm = {};
  thisMonthActs.forEach(a => {
    const st = getSportType(a);
    const wt = classifyWorkout(a, targetPace, st);
    const key = `${st}/${wt}`;
    sportCounts[key] = (sportCounts[key] || 0) + 1;
    sportKm[key] = (sportKm[key] || 0) + a.distance / 1000;
  });

  const sportSummary = Object.entries(sportCounts)
    .map(([k, v]) => `${k}: ${v}회 (${sportKm[k].toFixed(1)}km)`)
    .join('\n') || '기록 없음';

  // 지난 달 운동 종류별 집계
  const lastSportCounts = {};
  const lastSportKm = {};
  lastMonthActs.forEach(a => {
    const st = getSportType(a);
    const wt = classifyWorkout(a, targetPace, st);
    const key = `${st}/${wt}`;
    lastSportCounts[key] = (lastSportCounts[key] || 0) + 1;
    lastSportKm[key] = (lastSportKm[key] || 0) + a.distance / 1000;
  });
  const lastSportSummary = Object.entries(lastSportCounts)
    .map(([k, v]) => `${k}: ${v}회 (${lastSportKm[k].toFixed(1)}km)`)
    .join('\n') || '기록 없음';

  // 레이스까지 남은 월 목록 계산
  let monthRoadmap = '';
  if (goal?.race_date) {
    const raceDate = new Date(goal.race_date);
    const nowDate  = new Date(ctx.today);
    const roadmapMonths = [];
    let cur = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
    const raceYM = new Date(raceDate.getFullYear(), raceDate.getMonth(), 1);
    while (cur <= raceYM) {
      const isNow  = cur.getMonth() === nowDate.getMonth() && cur.getFullYear() === nowDate.getFullYear();
      const isRace = cur.getMonth() === raceDate.getMonth() && cur.getFullYear() === raceDate.getFullYear();
      roadmapMonths.push(`${cur.getMonth()+1}월${isNow ? '(현재)' : ''}${isRace ? '(레이스)' : ''}`);
      cur.setMonth(cur.getMonth() + 1);
    }
    monthRoadmap = roadmapMonths.join(' → ');
  }

  const prompt = `마라톤 전문 코치로서 월간 종합 리포트를 작성하세요.

📅 오늘: ${ctx.todayLabel} | ${ctx.monthLabel} ${ctx.weekOfMonth}주차
이번 달(${ctx.monthStart} ~ ${ctx.monthEnd}) 현재까지: ${thisMonthKm}km / ${thisMonthActs.length}회

선수: ${goal?.race_name || '마라톤'} ${goal?.target_time || ''} (${targetPace}/km) | D-${daysLeft || '?'} | ${trainingPhase}
PR: 풀 ${goal?.pr_full || '-'} / 하프 ${goal?.pr_half || '-'} / 10K ${goal?.pr_10k || '-'}
훈련 페이스: 인터벌 ${calcPaceOffset(targetPace,30)} | 템포 ${calcPaceOffset(targetPace,15)} | LSD ${calcPaceOffset(targetPace,-60)} | 회복 ${calcPaceOffset(targetPace,-40)}
${monthRoadmap ? `레이스까지 월별 로드맵: ${monthRoadmap}` : ''}

이번 달 현재까지 (${ctx.monthStart} ~ ${ctx.today}):
- 총 거리: ${thisMonthKm}km | 총 ${thisMonthActs.length}회
- 운동 구성:
${sportSummary}

지난 달 (전월 전체):
- 총 거리: ${lastMonthKm}km | 총 ${lastMonthActs.length}회
- 운동 구성:
${lastSportSummary}

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
순서: ${monthRoadmap || '(레이스 날짜 미설정)'}
위 순서대로 각 월의 핵심 훈련 테마를 한 줄씩 작성하세요.

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
  const ctx = getDateContext();

  // 이번 주 (월요일 00:00 KST ~ 현재)
  const thisWeekAfter = Math.floor(new Date(ctx.weekStart + 'T00:00:00+09:00').getTime() / 1000);
  const thisWeekRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${thisWeekAfter}&per_page=30`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  ).then(r => r.json());
  const thisWeekActs = Array.isArray(thisWeekRes) ? thisWeekRes : [];

  // 지난 주 (저번 주 월~일)
  const lastWeekEnd   = thisWeekAfter;
  const lastWeekStart = lastWeekEnd - 7 * 24 * 60 * 60;
  const lastWeekRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${lastWeekStart}&before=${lastWeekEnd}&per_page=30`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  ).then(r => r.json());

  const lastWeekActs = Array.isArray(lastWeekRes) ? lastWeekRes : [];

  // 이번 주 종목별 집계
  const thisSwimKm = (thisWeekActs.filter(a => getSportType(a) === '수영').reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);
  const thisBikeKm = (thisWeekActs.filter(a => getSportType(a) === '자전거').reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);
  const thisRunKm  = (thisWeekActs.filter(a => ['러닝','트레일런'].includes(getSportType(a))).reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);

  // 지난 주 종목별 집계
  const swimKm = (lastWeekActs.filter(a => getSportType(a) === '수영').reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);
  const bikeKm = (lastWeekActs.filter(a => getSportType(a) === '자전거').reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);
  const runKm  = (lastWeekActs.filter(a => ['러닝','트레일런'].includes(getSportType(a))).reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1);
  const totalMins = Math.floor(lastWeekActs.reduce((s, a) => s + a.moving_time, 0) / 60);
  const brickSessions = lastWeekActs.filter(a => getSportType(a) === '자전거').length;

  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const thisWeekSummary = thisWeekActs.map(a => {
    const st = getSportType(a);
    const dow = dayNames[new Date(a.start_date).getDay()];
    return `- [${dow}] [${st}] ${(a.distance/1000).toFixed(1)}km / ${Math.floor(a.moving_time/60)}분`;
  }).join('\n') || '이번 주 기록 없음';

  const lastWeekSummary = lastWeekActs.map(a => {
    const st = getSportType(a);
    return `- [${st}] ${(a.distance/1000).toFixed(1)}km / ${Math.floor(a.moving_time/60)}분`;
  }).join('\n') || '기록 없음';

  // A1: 이전 코칭 노트
  const prevCoachingNote = await fetchCoachingNote(userId, 'weekly_tri');

  // S2: 계획 대비 실행
  const planComparison = await fetchWeeklyPlanComparison(userId, ctx.weekStart, thisWeekActs, targetPace);

  // S3: 현재 체력 페이스
  const currentFitnessPace = await calcCurrentFitnessPace(accessToken);
  const targetSec = paceToSec(targetPace);
  const fitnessSec = currentFitnessPace ? paceToSec(currentFitnessPace) : null;
  const paceGap = fitnessSec ? fitnessSec - targetSec : null;

  // S5: 주간 KPI
  const totalThisKm = parseFloat(thisRunKm) + parseFloat(thisBikeKm) + parseFloat(thisSwimKm);
  const triWeeklyTarget = 80; // 트라이애슬론 주간 목표
  const kpiSummary = `러닝 ${thisRunKm}km | 자전거 ${thisBikeKm}km | 수영 ${thisSwimKm}km${planComparison ? ` | 계획이행 ${planComparison.rate}%` : ''}`;

  const remainingStr = ctx.remainingDaysCount > 0
    ? `${ctx.remainingDays.join(', ')}${ctx.hasSundayLeft ? ' (일요일: 일산호수 LSD 고정)' : ''}`
    : '없음 (오늘이 일요일)';

  const prompt = `트라이애슬론 전문 코치로서 주간 리포트를 작성하세요.

📅 오늘: ${ctx.todayLabel} | 이번 주 ${ctx.weekDayNum}일차 | ${ctx.weekRange}
📊 이번 주 KPI: ${kpiSummary}
🏃 현재 러닝 체력 페이스: ${currentFitnessPace || '데이터 부족'}${paceGap !== null ? ` (목표 대비 ${paceGap > 0 ? '+' + paceGap : paceGap}초/km)` : ''}
남은 요일: ${remainingStr}
${planComparison ? `\n📋 계획 vs 실행 (월~${ctx.todayDowName}):\n${planComparison.text}\n` : ''}

선수 목표:
- 마라톤: ${goal?.target_time || '--'} (페이스 ${targetPace}/km)
- 트라이애슬론: ${triTypeLabel} ${goal?.tri_total_target || '완주'} | D-${daysLeft || '?'}
- 수영목표 ${goal?.tri_swim_target || '-'} / 자전거목표 ${goal?.tri_bike_target || '-'} / 러닝목표 ${goal?.tri_run_target || '-'}

이번 주 완료된 훈련 (월~${ctx.todayDowName}):
${thisWeekSummary}

지난 주 훈련 (전주 전체):
- 수영: ${swimKm}km | 자전거: ${bikeKm}km | 러닝: ${runKm}km
- 총 훈련시간: ${Math.floor(totalMins/60)}시간 ${totalMins%60}분
- 벽돌훈련: ${brickSessions}회
${lastWeekSummary}
${prevCoachingNote ? `\n📝 지난 주 코치 핵심 조언 (follow-up):\n${prevCoachingNote}\n` : ''}
2000자 이내로 작성:

**지난 주 평가**
(종목별 볼륨 평가, 균형 분석. ${prevCoachingNote ? '지난 코치 조언 이행 여부 반드시 언급.' : ''} 3-4문장)

**이번 주 현황 & 남은 훈련 처방**
오늘(${ctx.todayLabel})까지 완료. 남은 요일(${ctx.remainingDays.join('/')})에 맞춰 처방:
${ctx.hasSundayLeft ? '- 일요일은 일산호수마라톤 일요정모 LSD 고정' : ''}
${currentFitnessPace ? `러닝 체력 페이스 ${currentFitnessPace}/km — 목표까지 ${Math.abs(paceGap || 0)}초 개선 필요.` : ''}

**다음 주 훈련 계획**

| 요일 | 훈련 | 거리/시간 | 강도 |
|------|------|---------|------|
| 월 | | | |
| 화 | | | |
| 수 | | | |
| 목 | | | |
| 금 | 휴식 | - | - |
| 토 | 벽돌훈련(자전거+러닝) | | |
| 일 | LSD (일산호수 일요정모) | | |

**핵심 훈련 상세**
1. [벽돌훈련 - 자전거 거리/강도 → 러닝 거리/페이스]
2. [장거리 수영 or 자전거]
3. [마라톤 페이스런]

**이번 주 핵심 포인트**
(트라이애슬론과 마라톤 병행 관련 2-3가지)`;

  const analysis = await callClaude(prompt, 1800);

  // A1: 코칭 노트 저장
  await saveCoachingNote(userId, 'weekly_tri', ctx.weekStart, analysis);
  await saveWeeklyPlan(userId, analysis, goal);
  return analysis;
}

// ══════════════════════════════════════
// A1: 코칭 메모리 — 저장/불러오기
// coaching_notes 테이블 필요:
//   user_id text, type text, week_start text,
//   advice_summary text, created_at timestamptz default now()
//   PRIMARY KEY (user_id, type)  → upsert on conflict
// ══════════════════════════════════════
async function fetchCoachingNote(userId, type) {
  try {
    const rows = await sbGet('coaching_notes',
      `user_id=eq.${userId}&type=eq.${type}&order=created_at.desc&limit=1`);
    return rows?.[0]?.advice_summary || null;
  } catch (e) {
    console.error('fetchCoachingNote error:', e.message);
    return null;
  }
}

async function saveCoachingNote(userId, type, weekStart, summary) {
  try {
    // summary에서 핵심 조언 400자 이내로 추출 (AI 호출 없이 앞부분 사용)
    const brief = summary.replace(/#{1,3}\s+/g, '').replace(/\*{1,2}/g, '').trim().slice(0, 400);
    await sbUpsert('coaching_notes',
      { user_id: userId, type, week_start: weekStart, advice_summary: brief, created_at: new Date().toISOString() },
      'user_id,type'
    );
  } catch (e) {
    console.error('saveCoachingNote error:', e.message);
  }
}

// ══════════════════════════════════════
// S3: 현재 체력 추정 페이스 계산
// 최근 4주 러닝 활동 평균 페이스 → 목표 페이스 대비 갭
// ══════════════════════════════════════
async function calcCurrentFitnessPace(accessToken) {
  try {
    const fourWeeksAgo = Math.floor(Date.now() / 1000) - 28 * 24 * 60 * 60;
    const res = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${fourWeeksAgo}&per_page=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    ).then(r => r.json());
    const runs = Array.isArray(res)
      ? res.filter(a => ['러닝', '트레일런'].includes(getSportType(a)) && a.distance >= 3000)
      : [];
    if (runs.length === 0) return null;

    // 5km 이상 LSD/이지런 제외(너무 느린 것), 최근 페이스 가중
    const paces = runs.map(a => ({
      sec: a.moving_time / (a.distance / 1000),
      dist: a.distance,
      date: new Date(a.start_date)
    })).filter(p => p.sec > 200 && p.sec < 500); // 3:20~8:20/km 범위만

    if (paces.length === 0) return null;

    // 최근 2주 가중 2배
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    let totalWeightedSec = 0, totalWeight = 0;
    paces.forEach(p => {
      const w = p.date.getTime() > twoWeeksAgo ? 2 : 1;
      totalWeightedSec += p.sec * w;
      totalWeight += w;
    });
    const avgSec = totalWeightedSec / totalWeight;
    const mm = Math.floor(avgSec / 60);
    const ss = String(Math.round(avgSec % 60)).padStart(2, '0');
    return `${mm}:${ss}`;
  } catch (e) {
    console.error('calcCurrentFitnessPace error:', e.message);
    return null;
  }
}

// ══════════════════════════════════════
// S2: 계획 대비 실행 비교
// weekly_plans 테이블에서 이번 주 계획 가져와서 실제와 대조
// ══════════════════════════════════════
async function fetchWeeklyPlanComparison(userId, weekStart, thisWeekActs, targetPace) {
  try {
    const plans = await sbGet('weekly_plans', `user_id=eq.${userId}&week_start=eq.${weekStart}`);
    if (!plans || plans.length === 0) return null;

    const plan = plans[0];
    const dayMap = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' };
    const dayLabel = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };

    // 오늘까지만 비교 (미래 요일은 제외)
    const KST_OFFSET = 9 * 60 * 60 * 1000;
    const nowKST = new Date(Date.now() + KST_OFFSET);
    const todayDow = nowKST.getUTCDay(); // 0=일, 1=월 ... 6=토

    // 완료된 요일별 활동 맵
    const doneByDay = {};
    thisWeekActs.forEach(a => {
      const actDate = new Date(a.start_date);
      const dow = actDate.getDay();
      const key = dayMap[dow];
      if (!doneByDay[key]) doneByDay[key] = [];
      doneByDay[key].push(`${getSportType(a)} ${(a.distance/1000).toFixed(1)}km@${calcPace(a.moving_time,a.distance)}`);
    });

    // 월~오늘까지만 비교
    const daysToCheck = ['mon','tue','wed','thu','fri','sat','sun'];
    const dowOrder = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
    const comparisons = [];

    for (const day of daysToCheck) {
      const planDow = dowOrder[day];
      // 오늘(todayDow) 포함, 이미 지난 요일만 비교
      const isPast = planDow === 0
        ? todayDow === 0 || todayDow > 0 // 일요일: 오늘이 일요일이면 포함
        : planDow <= todayDow;
      if (!isPast) continue;

      const planned = plan[day] || '';
      if (!planned || planned === '') continue;

      const done = doneByDay[day] || [];
      const isRest = planned === '휴식';
      const isCompleted = isRest ? true : done.length > 0;

      comparisons.push(
        `- ${dayLabel[day]}: 계획[${planned}] → ${isCompleted ? `✅ ${done.join(', ')}` : '❌ 미완료'}`
      );
    }

    if (comparisons.length === 0) return null;

    const completedCount = comparisons.filter(l => l.includes('✅')).length;
    const totalCount = comparisons.length;
    const rate = Math.round(completedCount / totalCount * 100);

    return {
      text: comparisons.join('\n'),
      completedCount,
      totalCount,
      rate
    };
  } catch (e) {
    console.error('fetchWeeklyPlanComparison error:', e.message);
    return null;
  }
}

// ══════════════════════════════════════
// S5: 훈련 완료율 KPI 계산
// LSD 완료율, 주간 거리 달성률, 강도훈련 횟수
// ══════════════════════════════════════
function calcWeeklyKPI(thisWeekActs, weeklyTarget, targetPace) {
  const runActs = thisWeekActs.filter(a =>
    ['러닝', '트레일런'].includes(getSportType(a))
  );

  // 거리 달성률
  const totalKm = thisWeekActs.reduce((s, a) => s + a.distance, 0) / 1000;
  const distRate = Math.round(totalKm / weeklyTarget * 100);

  // LSD 완료 여부 (10km 이상 이지런/LSD)
  const lsdActs = runActs.filter(a => a.distance >= 10000);
  const lsdCount = lsdActs.length;

  // 강도훈련 횟수 (인터벌/템포: 목표페이스보다 빠른 활동)
  const targetSec = paceToSec(targetPace);
  const intensityActs = runActs.filter(a => {
    const paceSec = a.moving_time / (a.distance / 1000);
    return paceSec < (targetSec + 10) && a.distance >= 3000; // 목표페이스 ±10초 이내
  });
  const intensityCount = intensityActs.length;

  return {
    totalKm: totalKm.toFixed(1),
    weeklyTarget,
    distRate,
    lsdCount,
    intensityCount,
    summary: `거리 ${totalKm.toFixed(1)}km/${weeklyTarget}km(${distRate}%) | LSD ${lsdCount}회 | 강도훈련 ${intensityCount}회`
  };
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
// ══════════════════════════════════════
// PR 자동 갱신 — Strava best_efforts(구간 최고기록) 기반
// 새 러닝 활동이 저장될 때마다 goals의 PR과 비교해 더 빠르면 갱신
// ══════════════════════════════════════
const PR_EFFORTS = {
  'Marathon':      { key: 'pr_full', label: '풀코스' },
  'Half-Marathon': { key: 'pr_half', label: '하프코스' },
  '10K':           { key: 'pr_10k',  label: '10K' },
  '5K':            { key: 'pr_5k',   label: '5K' },
};

function prTimeToSec(t) {
  if (!t || typeof t !== 'string') return Infinity;
  const p = t.trim().split(':').map(Number);
  if (p.some(isNaN)) return Infinity;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return Infinity;
}

function prSecToTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

async function checkAndUpdatePR(userId, activity, goal, accessToken, chatId) {
  try {
    if (!goal?.id) return;
    // 실외 러닝만 (트레드밀 VirtualRun은 거리 정확도 문제로 제외)
    const st = activity.sport_type || activity.type;
    if (st !== 'Run' && st !== 'TrailRun') return;
    if ((activity.distance || 0) < 4900) return;

    // 요약 활동에는 best_efforts가 없으므로 상세 조회
    let efforts = activity.best_efforts;
    if (!Array.isArray(efforts)) {
      const r = await fetch(`https://www.strava.com/api/v3/activities/${activity.id}`,
        { headers: { Authorization: `Bearer ${accessToken}` } });
      const detail = await r.json();
      efforts = Array.isArray(detail.best_efforts) ? detail.best_efforts : [];
    }

    const updates = {};
    const improved = [];
    const now = new Date().toISOString();
    for (const e of efforts) {
      const map = PR_EFFORTS[e.name];
      if (!map || !e.elapsed_time) continue;
      const current = prTimeToSec(goal[map.key]);
      if (e.elapsed_time < current) {
        const newTime = prSecToTime(e.elapsed_time);
        updates[map.key] = newTime;
        updates[`${map.key}_updated_at`] = now;
        improved.push(`🏅 <b>${map.label}</b>: ${goal[map.key] || '-'} → <b>${newTime}</b>`);
      }
    }
    if (improved.length === 0) return;

    await sbPatch('goals', `id=eq.${goal.id}`, updates);
    Object.assign(goal, updates); // 같은 동기화에서 다음 활동 비교 시 최신 PR 사용

    if (chatId && process.env.TELEGRAM_BOT_TOKEN) {
      const msg = `🎉 <b>개인 최고 기록(PB) 갱신!</b>\n─────────\n${improved.join('\n')}\n\n📅 ${activity.start_date_local?.slice(0, 10) || ''} · ${activity.name}`;
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' })
      });
    }
  } catch (e) {
    console.error('PR check error:', e.message); // PR 실패가 동기화 전체를 막지 않도록
  }
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
      await sbUpsert('reports', { user_id: userId, type: 'weekly', content: analysis }, 'user_id,type');
      const title = isTri ? '🏊🚴🏃 <b>트라이애슬론 주간 리포트</b>' : '📅 <b>주간 훈련 리포트</b>';
      await sendTelegram(profile.telegram_chat_id, title, analysis);
      return res.json({ success: true, type: 'weekly' });
    }

    // 월간 분석
    if (type === 'monthly') {
      const analysis = await analyzeMonthly(userId, goal, accessToken);
      await sbUpsert('reports', { user_id: userId, type: 'monthly', content: analysis }, 'user_id,type');
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

    // A1+S3: 일일 분석에 필요한 데이터 사전 로드
    const dailyCoachingNote = await fetchCoachingNote(userId, 'daily');
    const dailyFitnessPace = await calcCurrentFitnessPace(accessToken);

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
          await checkAndUpdatePR(userId, activity, goal, accessToken, profile.telegram_chat_id);
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

        await checkAndUpdatePR(userId, activity, goal, accessToken, profile.telegram_chat_id);

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

        // 날씨 + 컨디션
        const weather = await fetchWeather(
          activity.start_latlng?.[0],
          activity.start_latlng?.[1],
          activity.start_date
        );
        const condition = await fetchUserCondition(userId, activity.start_date);

        const analysis = await analyzeDailyActivity(
          activity, goal, recentSaved.slice(0, 6),
          workoutType, sportType, phases, details, weather, condition,
          dailyCoachingNote, dailyFitnessPace
        );

        // A1: 일일 코칭 노트 저장
        const ctx = getDateContext();
        await saveCoachingNote(userId, 'daily', ctx.weekStart, analysis);

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
