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

// 목표 레이스 페이스 — 목표 기록(target_time)에서 계산. 저장된 target_pace는 앱 기본값(5:27)으로 잘못 저장된 경우가 있어 보조로만 사용
function goalPaceSec(goal) {
  const p = String(goal?.target_time || '').trim().split(':').map(Number);
  if (p.length === 3 && !p.some(isNaN)) {
    const t = p[0] * 3600 + p[1] * 60 + p[2];
    if (t > 2 * 3600 && t < 8 * 3600) return t / 42.195;
  }
  return goal?.target_pace ? paceToSec(goal.target_pace) : null;
}
function goalPaceStr(goal) {
  const s = goalPaceSec(goal);
  if (!s) return '-';
  const r = Math.round(s);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
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
  // 평지 환산 페이스: 오르막 1m ≈ 평지 8m (100m 상승 ≈ 평지 0.8km 추가). 오르막은 같은 시간에 더 많은 일을 한 것이므로 환산 페이스는 더 빨라짐
  // (예전 식은 시간을 더해서 환산 페이스가 실제보다 느려지는 반대 방향이었음)
  const equivalentDistance = distance + (elevation || 0) * 8;
  const sec = movingTime / (equivalentDistance / 1000);
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
function classifyWorkout(activity, refPace, sportType, zones = null, laps = null) {
  if (isCrossTraining(sportType)) return sportType;
  const elevation = activity.total_elevation_gain || 0;
  // refPace = 현재 마라톤 페이스(레이스 환산). 목표 페이스를 넣으면 목표보다 느린 선수의 템포런이 이지런으로 분류됨
  const mpSec = paceToSec(refPace);
  // 랩에서 워크아웃 구조(인터벌·언덕 반복·템포)가 확인되면 코스 경사보다 우선
  if (sportType !== '트레일런' && activity.distance < 38000) {
    const structure = detectWorkoutStructure(laps, mpSec, { distance: activity.distance, zones });
    if (structure?.primary) return structure.type;
  }
  // 트레일·경사 코스(km당 15m 이상)는 평지 환산 페이스로 강도 판단 — 경사 코스를 편하게 뛴 건 이지런 (언덕훈련 = 오르막 반복이 확인된 경우만)
  const hill = classifyHill(activity.distance, elevation);
  if (sportType === '트레일런' || (hill && hill.elevPerKm >= 15)) {
    const adjSec = paceToSec(calcAdjustedPace(activity.moving_time, activity.distance, elevation));
    return classifyRunIntensity({ ...activity, moving_time: adjSec * activity.distance / 1000 }, mpSec, zones, null);
  }
  return classifyRunIntensity(activity, mpSec, zones, laps);
}

// ── 웜업/주훈련/쿨다운 구간 분석 ──
// 랩 구간 분석 — 그 러닝 자체의 중앙 페이스 기준 (목표 페이스와 무관)
// 웜업/쿨다운: 앞·뒤 최대 2랩 중 중앙 페이스보다 15초 이상 느린 랩. 전·후반 스플릿과 페이스 편차도 계산
function analyzePhases(laps) {
  const valid = (laps || []).filter(l => l.distance >= 300 && l.moving_time > 0);
  if (valid.length < 3) return null;
  const pace = (l) => l.moving_time / (l.distance / 1000);
  const med = median(valid.map(pace));
  const phases = { warmup: [], main: [], cooldown: [] };
  valid.forEach((lap, i) => {
    if (i < 2 && phases.main.length === 0 && pace(lap) > med + 15) phases.warmup.push(lap);
    else phases.main.push(lap);
  });
  while (phases.main.length > 3 && phases.cooldown.length < 2 &&
         pace(phases.main[phases.main.length - 1]) > med + 15) {
    phases.cooldown.unshift(phases.main.pop());
  }
  const km = (ls) => (ls.reduce((s, l) => s + l.distance, 0) / 1000).toFixed(1);
  const avgPace = (ls) => ls.reduce((s, l) => s + l.moving_time, 0) / (ls.reduce((s, l) => s + l.distance, 0) / 1000);
  const main = phases.main;
  const half = Math.floor(main.length / 2);
  const firstP = half > 0 ? avgPace(main.slice(0, half)) : null;
  const secondP = half > 0 ? avgPace(main.slice(half)) : null;
  const mp = main.map(pace);
  const sd = Math.sqrt(mp.reduce((s, v) => s + (v - avgPace(main)) ** 2, 0) / mp.length);
  const split = firstP && secondP ? Math.round(secondP - firstP) : null;
  return {
    warmupKm: km(phases.warmup), mainKm: km(main), cooldownKm: km(phases.cooldown),
    mainPace: secToPaceStr(avgPace(main)),
    splitText: split === null ? '' : `전반 ${secToPaceStr(firstP)} → 후반 ${secToPaceStr(secondP)} (${split > 0 ? `+${split}초 느려짐` : split < 0 ? `${-split}초 빨라짐(네거티브)` : '이븐'})`,
    paceSdSec: Math.round(sd)
  };
}

// ── 주간 시작일 (월요일 기준) ──
// 한국 시간(KST) 기준 날짜 도구 — 서버는 UTC로 돌기 때문에 getDay() 등을 그대로 쓰면 요일이 틀어짐
// (예: 일요일 아침 7시 일산호수 LSD = UTC 토요일 22시)
const KST_MS = 9 * 60 * 60 * 1000;
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
const DOW_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// UTC 시각(문자열/Date/ms) → KST 벽시계 값을 UTC 필드로 갖는 Date (getUTC*로 읽을 것)
function toKst(t) {
  if (t instanceof Date) return new Date(t.getTime() + KST_MS);
  if (typeof t === 'number') return new Date(t + KST_MS);
  const s = String(t);
  const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(s);
  return new Date(Date.parse(hasTz ? s : s.replace(' ', 'T') + 'Z') + KST_MS); // DB 시각은 UTC(타임존 표기 없음)
}
function ymd(k) {
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`;
}
function kstDow(t) { return toKst(t).getUTCDay(); }
function utcMs(t) { return toKst(t).getTime() - KST_MS; } // 어떤 형식이든 UTC 밀리초로
function kstLabel(t) { const k = toKst(t); return `${k.getUTCMonth() + 1}/${k.getUTCDate()}(${DOW_KO[k.getUTCDay()]})`; }

function getWeekStart(date = new Date()) {
  const k = toKst(date);
  const dow = k.getUTCDay();
  k.setUTCDate(k.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return ymd(k);
}

// ── 날짜 컨텍스트 계산 (오늘 기준) ──
function getDateContext(anchor = Date.now()) {
  const now = toKst(anchor);
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

  // 남은 요일 목록 (오늘 포함 X, 일요일까지) + 날짜 붙인 라벨
  const remainingDays = [];
  const remainingDayLabels = [];
  const remainingDayDates = [];
  for (let i = todayDow === 0 ? 7 : todayDow + 1; i <= 7; i++) {
    const dow = i === 7 ? 0 : i;
    if (todayDow === 0) break; // 일요일이면 이번 주 남은 날 없음
    remainingDays.push(dayNames[dow]);
    const d = new Date(now); d.setUTCDate(now.getUTCDate() + (i - todayDow));
    remainingDayLabels.push(`${d.getUTCMonth() + 1}/${d.getUTCDate()}(${dayNames[dow]})`);
    remainingDayDates.push(ymd(d));
  }
  // 다음 주 월~일 날짜 라벨 (일요일 분석·주말 주간 리포트용)
  const nextWeekLabels = [];
  const nextWeekDates = [];
  const nextMon = new Date(now); nextMon.setUTCDate(now.getUTCDate() + (todayDow === 0 ? 1 : 8 - todayDow));
  for (let i = 0; i < 7; i++) {
    const d = new Date(nextMon); d.setUTCDate(nextMon.getUTCDate() + i);
    nextWeekLabels.push(`${d.getUTCMonth() + 1}/${d.getUTCDate()}(${dayNames[(i + 1) % 7]})`);
    nextWeekDates.push(ymd(d));
  }

  // 월간: 이번 달 1일 ~ 말일
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

  // 이번 달 몇 주차
  const weekOfMonth = Math.ceil(now.getUTCDate() / 7);

  const fmt = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;

  return {
    today: fmt(now),
    todayIsoLabel: `${now.getUTCMonth() + 1}/${now.getUTCDate()}(${dayNames[todayDow]})`,
    todayLabel: `${now.getUTCMonth()+1}월 ${now.getUTCDate()}일 (${dayNames[todayDow]})`,
    todayDow,
    todayDowName: dayNames[todayDow],
    weekDayNum,            // 주의 몇 번째 날 (1~7)
    weekStart: fmt(weekMonday),
    weekEnd:   fmt(weekSunday),
    weekRange: `${now.getUTCMonth()+1}월 ${weekMonday.getUTCDate()}일(월) ~ ${weekSunday.getUTCMonth()+1}월 ${weekSunday.getUTCDate()}일(일)`,
    remainingDays,         // 남은 요일 한글 배열 (오늘 제외)
    remainingDayLabels,    // 남은 요일 날짜 라벨 ['11/28(금)', ...]
    remainingDayDates,     // 같은 날들의 'YYYY-MM-DD'
    nextWeekDates,
    nextWeekLabels,        // 다음 주 월~일 날짜 라벨
    nextWeekStart: ymd(nextMon),
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
    const date = ymd(toKst(activityDate)); // KST 날짜 (아침 9시 전 러닝이 전날로 잡히지 않도록)
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

// ── Claude API 공통 호출 ──
// Haiku 5.5: 생각(thinking) 블록이 먼저 올 수 있어 text 블록만 골라 읽음.
// 토큰이 약 30% 더 들고 생각 분량도 max_tokens에 포함되므로 한도를 넉넉히 줌.
// effort: 일간·컨디션은 low, 계획을 짜는 주간·월간·레이스 전략은 medium.
// 5.5 요청이 실패하면 기존 Haiku 4.5로 한 번 더 시도(분석이 멈추지 않게).
async function askClaude(prompt, maxTokens, effort = 'low') {
  const call = async (body) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!res.ok || !text || data.stop_reason === 'refusal') {
      console.error('Claude 응답 실패', body.model, res.status, data.error?.message || data.stop_reason);
      return null;
    }
    return text;
  };
  const messages = [{ role: 'user', content: prompt }];
  return (await call({ model: 'claude-haiku-5-5', max_tokens: Math.round(maxTokens * (effort === 'low' ? 1.6 : 2.2)) + 400, output_config: { effort }, messages }))
      ?? (await call({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, messages }));
}

async function callClaude(prompt, maxTokens, effort = 'low') {
  return (await askClaude(prompt, maxTokens, effort)) || '분석을 불러올 수 없습니다.';
}

// ── 마크다운 → 텔레그램 HTML ──
// 텔레그램 HTML 모드용 특수문자 처리 (<, >, & 가 있으면 메시지 전체가 거부됨)
function escapeTg(t) {
  return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mdToTelegram(text) {
  const lines = escapeTg(text).split('\n');
  const isSep = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (isSep(line)) continue;                         // |---|---| 구분선
      if (isSep(lines[i + 1] || '')) continue;           // 머리글 행
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      out.push('• ' + cells.join(' · '));                // 표 행 → 목록 (예전엔 통째로 삭제됨)
      continue;
    }
    out.push(line);
  }
  return out.join('\n')
    .replace(/^#{1,4} (.+)$/gm, '\n<b>$1</b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^\s*[-]{3,}\s*$/gm, '─────────')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 4096자 제한: 자르지 않고 문단 단위로 나눠 여러 메시지로 발송 (태그가 잘려 전송 실패하는 것 방지)
function splitTelegram(msg, limit = 3900) {
  if (msg.length <= limit) return [msg];
  const parts = [];
  let cur = '';
  for (const para of msg.split('\n\n')) {
    const piece = para.length > limit ? para.slice(0, limit) : para;
    if ((cur ? cur.length + 2 : 0) + piece.length > limit) { parts.push(cur); cur = piece; }
    else cur = cur ? `${cur}\n\n${piece}` : piece;
  }
  if (cur) parts.push(cur);
  return parts;
}

async function sendTelegram(chatId, title, analysis) {
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return;
  const parts = splitTelegram(`${title}\n─────────\n${mdToTelegram(analysis)}`);
  for (let i = 0; i < parts.length; i++) {
    const text = parts.length > 1 && i > 0 ? `(${i + 1}/${parts.length})\n${parts[i]}` : parts[i];
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    if (!r.ok) {
      // HTML 해석 실패 시 서식 없이라도 전달
      const plain = text.replace(/<\/?b>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: plain })
      });
    }
  }
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
// ══════════════════════════════════════
// 코칭 공통 기반 — 현재 실력 기준 페이스·분류, 개인화 주간 목표, 코칭 원칙
// 일간·주간·월간·트라이 모든 프롬프트가 같은 기준을 쓰도록 한 곳에서 계산
// ══════════════════════════════════════
const COACHING_RULES = `[코칭 원칙 — 반드시 지킬 것]
1. 처방 페이스·심박은 [현재 실력 기준 훈련 페이스]와 [심박 구간]의 값만 사용. 목표 레이스 페이스로 훈련을 처방하지 말 것.
2. 강훈련(인터벌·템포런·페이스주·20km 이상 LSD) 다음 날은 이지런 또는 휴식. 강훈련 이틀 연속 금지.
3. 놓친 훈련·부족한 거리를 남은 요일에 몰아서 보충하지 말 것. 미달은 그대로 인정하고 다음 계획에 반영.
4. 주간 거리는 [주간 목표 거리] 근처로. 크게 넘기지 말 것 (평소 훈련량 대비 +10% 이내).
5. 주간 훈련의 약 80%는 이지 강도. 이지런이 느린 것은 문제가 아니고, 이지런이 이지 구간보다 센 것이 문제.
6. 데이터에 있는 사실만 근거로 평가. 근거 없는 원인 추정이나 "심각", "저하" 같은 과장 금지. 잘한 점은 숫자로 구체적으로 인정.
7. 처방에는 반드시 날짜와 요일(예: 11/28(금))을 붙일 것. "Day 2" 같은 표현 금지.
8. 일요일은 일산호수 정모 LSD 고정 — 거리가 아니라 시간 기준으로 처방(예: LSD 2시간, 이 선수 LSD 페이스로 약 OOkm는 괄호로).
9. 부상·피로 기록이 있거나 풀코스 후 14일 이내면 회복을 최우선.
10. 표(|) 대신 목록(-)으로 작성.`;

const QUALITY_TYPES = ['인터벌', '템포런', '페이스주', '언덕훈련'];
const RUN_LABELS = ['이지런', 'LSD', '롱런', '페이스주', '템포런', '인터벌', '언덕훈련', '풀코스'];

// ── 일마 정모 일정 (구글 시트 CSV) ──
// 시트 열: 날짜 | 종류 | 시간 | 거리(km) | 코스 | 언덕 | 메모
// 언덕: O/Y/있음 또는 누적 상승 m(예: 150). 비워도 코스·메모에 '업힐·언덕·오르막'이 있으면 언덕 코스로 봄  — 헤더 이름으로 찾으므로 열 순서는 자유
// 일요 LSD는 시간 기준(예: 2:00, 2시간, 120분). 거리는 비워도 됨 → 개인 LSD 페이스로 예상 거리 환산
// CLUB_RUNS_CSV_URL 이 없거나 읽기에 실패하면 빈 목록 → 기존 규칙(일요일 일산호수 LSD)대로 동작
let clubRunsCache = null;
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(x => x.trim())).filter(r => r.some(Boolean));
}
function parseSheetMinutes(v) {
  const t = String(v || '').replace(/\s/g, '');
  if (!t) return null;
  let m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = t.match(/^(\d+(?:\.\d+)?)시간(?:(\d+)분)?$/);
  if (m) return Math.round(Number(m[1]) * 60 + Number(m[2] || 0));
  m = t.match(/^(\d+)분$/) || t.match(/^(\d+)$/);
  return m ? Number(m[1]) : null;
}
function parseSheetDate(v, anchor) {
  const t = String(v || '').replace(/\s/g, '');
  let m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[-./월](\d{1,2})/);
  if (!m) return null;
  const y = new Date(anchor + KST_MS).getUTCFullYear();
  const mo = Number(m[1]), d = Number(m[2]);
  const cand = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // 연말에 1~2월 일정을 적은 경우 다음 해로
  return Date.parse(cand) < anchor - 60 * 86400000 ? `${y + 1}${cand.slice(4)}` : cand;
}
async function fetchClubRuns(anchor = Date.now(), days = 45) {
  const url = process.env.CLUB_RUNS_CSV_URL;
  if (!url) return [];
  if (!clubRunsCache) {
    try {
      const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(url, { signal: ctrl.signal }); clearTimeout(tm);
      const body = await r.text();
      clubRunsCache = r.ok ? parseCsv(body) : [];
      const hasHeader = clubRunsCache[0]?.some(h => h.includes('날짜'));
      console.log(`정모 일정 시트: HTTP ${r.status}, ${clubRunsCache.length}행, 제목줄 ${hasHeader ? '확인' : '없음 → ' + body.slice(0, 80).replace(/\s+/g, ' ')}`);
    } catch (e) { console.error('정모 일정 읽기 실패', e.message); clubRunsCache = []; }
  }
  const [head, ...body] = clubRunsCache;
  if (!head) return [];
  const col = (k) => head.findIndex(h => h.includes(k));
  const ci = { date: col('날짜'), type: col('종류'), min: col('시간'), km: col('거리'), hill: col('언덕'), course: col('코스'), memo: col('메모') };
  if (ci.date < 0) return [];
  const today = ymd(new Date(anchor));
  const until = ymd(new Date(anchor + days * 86400000));
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  return body.map(r => {
    const date = parseSheetDate(r[ci.date], anchor);
    if (!date) return null;
    const kmRaw = ci.km >= 0 ? String(r[ci.km] || '') : '';
    const km = /half|하프/i.test(kmRaw) ? 21.1 : /full|풀/i.test(kmRaw) ? 42.195 : parseFloat(kmRaw.replace(/[^\d.]/g, ''));
    const dt = new Date(date + 'T00:00:00Z');
    const hv = ci.hill >= 0 ? String(r[ci.hill] || '').trim() : '';
    const hillM = parseFloat(hv.replace(/[^\d.]/g, ''));
    const text = `${ci.course >= 0 ? r[ci.course] : ''} ${ci.memo >= 0 ? r[ci.memo] : ''}`;
    const hill = /^(o|y|yes|있음|예|v|✓|○)$/i.test(hv) || hillM > 0 || /업힐|언덕|오르막|hill/i.test(text);
    return {
      hill, hillM: hillM > 0 ? Math.round(hillM) : null,
      date, km: isNaN(km) ? null : km, min: ci.min >= 0 ? parseSheetMinutes(r[ci.min]) : null,
      type: (ci.type >= 0 && r[ci.type]) || 'LSD',
      course: ci.course >= 0 ? r[ci.course] : '', memo: ci.memo >= 0 ? r[ci.memo] : '',
      label: `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}(${DOW[dt.getUTCDay()]})`
    };
  }).filter(x => x && x.date >= today && x.date <= until).sort((a, b) => a.date.localeCompare(b.date));
}
function fmtMin(min) { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}시간${m ? ` ${m}분` : ''}` : `${m}분`; }
// 시간 기준 LSD → 개인 이지·LSD 페이스(현재 MP+45~75초)로 예상 거리
function lsdKmRange(min, mpSec, hill = false) {
  if (!min || !mpSec) return null;
  const slow = hill ? 20 : 0;  // 언덕 코스는 같은 노력에 페이스가 느려지므로 약 20초/km 느리게 환산
  const a = Math.round(min * 60 / (mpSec + 75 + slow)), b = Math.round(min * 60 / (mpSec + 45 + slow));
  return { lo: a, hi: b, mid: Math.round((a + b) / 2) };
}
function clubRunsText(list, mpSec) {
  if (!list?.length) return '';
  return `[일마 정모 일정 — 클럽이 정한 확정 일정]\n` + list.map(c => {
    const est = c.min && !c.km ? lsdKmRange(c.min, mpSec, c.hill) : null;
    return `- ${c.label} ${c.type}${c.min ? ` ${fmtMin(c.min)}` : ''}${c.km ? ` ${c.km}km` : ''}` +
      `${est ? ` (이 선수 LSD 페이스로 약 ${est.lo}~${est.hi}km, 주간 거리 계산은 ${est.mid}km)` : ''}` +
      `${c.course ? ` · ${c.course}` : ''}${c.hill ? ` · ⛰️ 언덕 코스${c.hillM ? `(누적 상승 약 ${c.hillM}m)` : ''} — 강훈련으로 취급, 전날·다음 날은 이지런 또는 휴식, 페이스보다 심박·노력 기준으로 처방` : ''}${c.memo ? ` · ${c.memo}` : ''}`;
  }).join('\n') + '\n';
}

// DB 기록의 분류: 저장 시 랩까지 보고 분류한 값(workout_type)을 우선 사용 — DB 조회에는 랩이 없어서 다시 분류하면 인터벌이 이지런으로 보임
function runType(r, basics) {
  return RUN_LABELS.includes(r.workout_type) ? r.workout_type : classifyRunIntensity(r, basics.mp.sec, basics.zones, null);
}
// Strava에서 막 가져온 활동: 같은 활동이 DB에 있으면 그 분류, 없으면 직접 분류
function labelOf(a, basics) {
  const row = basics?.byId?.get(String(a.id));
  if (row && RUN_LABELS.includes(row.workout_type)) return row.workout_type;
  return classifyWorkout(a, basics.refPaceStr, getSportType(a), basics.zones, null);
}

function secToPaceStr(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// 워크아웃 구조 감지 (랩 기반) — 전체 평균·1km 스플릿으로는 이지런처럼 보이는 인터벌·언덕 반복·템포 구간을 찾아냄
// 시계 워크아웃의 랩(예: 500m 질주 ↔ 회복)은 Strava laps에 그대로 남음
// 반환: { type, text, primary } — primary=false면 분류는 바꾸지 않고 설명(text)만 제공 (예: LSD 끝 빠른 마무리)
function detectWorkoutStructure(laps, mpSec, opts = {}) {
  const v = (Array.isArray(laps) ? laps : []).filter(l => l.distance >= 150 && l.moving_time > 0);
  if (v.length < 5) return null;
  const total = v.reduce((s, l) => s + l.distance, 0);
  if (opts.distance && Math.abs(total - opts.distance) > opts.distance * 0.15) return null;  // 랩 데이터 신뢰 불가
  const pace = (l) => l.moving_time / (l.distance / 1000);
  const elevPerKm = (l) => (l.total_elevation_gain || 0) / (l.distance / 1000);
  const fmtKm = (m) => (m / 1000).toFixed(2).replace(/0$/, '');
  const sumD = (ls) => ls.reduce((s, l) => s + l.distance, 0);
  const avgPace = (ls) => ls.reduce((s, l) => s + l.moving_time, 0) / (sumD(ls) / 1000);
  const avgHr = (ls) => { const h = ls.filter(l => l.average_heartrate > 0); return h.length ? Math.round(h.reduce((s, l) => s + l.average_heartrate * l.moving_time, 0) / h.reduce((s, l) => s + l.moving_time, 0)) : null; };
  // 시계 자동 1km 랩인지 (자동 랩은 지형·신호대기로도 페이스가 출렁이므로 더 엄격하게)
  const auto1k = v.filter(l => Math.abs(l.distance - 1000) <= 30).length >= v.length * 0.7;

  // ① 반복 구간: 앞뒤 랩 평균보다 40초/km 이상 빠른 2.5km 이하 랩
  let work = v.map((l, i) => {
    const nb = [v[i - 1], v[i + 1]].filter(Boolean);
    const nbPace = nb.reduce((s, x) => s + pace(x), 0) / nb.length;
    return { l, i, isWork: l.distance <= 2500 && pace(l) <= nbPace - 40 };
  }).filter(x => x.isWork);
  let medDist = 0;
  if (work.length >= 3) {
    medDist = median(work.map(x => x.l.distance));
    work = work.filter(x => Math.abs(x.l.distance - medDist) <= medDist * 0.35);  // 비슷한 길이의 반복만
  }
  if (work.length >= 3 && work.length < v.length) {
    const idx = work.map(x => x.i);
    const gaps = idx.slice(1).map((x, k) => x - idx[k]);
    // 질주↔회복 반복 (400m×2 + 회복 같은 세트 구성도 인정: 간격 1~3랩)
    const regular = gaps.filter(g => g >= 1 && g <= 3).length >= gaps.length * 0.7;
    const workLaps = work.map(x => x.l);
    const idxSet = new Set(idx);
    const rec = v.filter((l, i) => i > idx[0] && i < idx[idx.length - 1] && !idxSet.has(i));
    const upWork = median(workLaps.map(elevPerKm));
    const upRec = rec.length ? median(rec.map(elevPerKm)) : 0;
    const isHill = upWork >= 10 && upRec < 5;
    const hr = avgHr(workLaps), recHr = avgHr(rec);
    const contrast = rec.length ? avgPace(rec) - avgPace(workLaps) : 0;
    // 실제로 힘을 썼나: 심박이 회복보다 높아야 함. 1km 자동 랩은 지형·신호대기 영향이 커서 더 엄격하게
    const hrOk = rec.length >= Math.max(1, work.length / 3) &&
      (hr && recHr ? hr - recHr >= (auto1k ? 8 : 5) : contrast >= 60) &&
      (!auto1k || contrast >= 60);
    const fastEnough = isHill || !mpSec || avgPace(workLaps) <= mpSec + 10;                              // 걷기 섞인 러닝 제외
    const downhillFast = upRec - upWork >= 5;                                                             // 내리막이라 빨랐던 것 제외
    if (regular && hrOk && fastEnough && !downhillFast) {
      const elev = Math.round(median(workLaps.map(l => l.total_elevation_gain || 0)));
      return {
        type: isHill ? '언덕훈련' : '인터벌', primary: true,
        text: `${isHill ? '언덕 반복' : '인터벌'} ${work.length}회 × ${fmtKm(medDist)}km (평균 ${secToPaceStr(avgPace(workLaps))}/km` +
          `${isHill ? `, 오르막 +${elev}m` : ''}${hr ? `, 심박 ${hr}` : ''})` +
          (rec.length ? ` / 회복 ${fmtKm(median(rec.map(l => l.distance)))}km ${secToPaceStr(avgPace(rec))}/km${recHr ? `, 심박 ${recHr}` : ''}` : '') +
          ` · 반복 페이스 ${secToPaceStr(Math.min(...workLaps.map(pace)))}~${secToPaceStr(Math.max(...workLaps.map(pace)))}`,
        stats: {
          workPaceSec: avgPace(workLaps), workHr: hr, recHr, recPaceSec: rec.length ? avgPace(rec) : null,
          firstPaceSec: pace(workLaps[0]), lastPaceSec: pace(workLaps[workLaps.length - 1]),
          repSec: median(workLaps.map(l => l.moving_time)), isHill,
          // 오르막 1m ≈ 평지 8m 로 환산한 반복 구간 페이스
          gradePct: isHill ? Math.round(median(workLaps.map(l => (l.total_elevation_gain || 0) / l.distance * 100)) * 10) / 10 : null,
          adjPaceSec: isHill ? workLaps.reduce((s, l) => s + l.moving_time, 0) / (workLaps.reduce((s, l) => s + l.distance + (l.total_elevation_gain || 0) * 8, 0) / 1000) : null
        }
      };
    }
  }

  // ② 템포 구간: 첫 랩 이후 (현재 마라톤 페이스 - 10초)보다 빠른 랩이 3km 이상 연속, 앞뒤보다 20초 이상 빠르고 심박도 높음
  if (mpSec) {
    let best = null, cur = [];
    const flush = () => { if (cur.length && (!best || sumD(cur) > sumD(best.laps))) best = { laps: cur, start: v.indexOf(cur[0]) }; cur = []; };
    v.forEach((l, i) => { if (i > 0 && pace(l) <= mpSec - 10) cur.push(l); else flush(); });
    flush();
    if (best && sumD(best.laps) >= 3000 && sumD(best.laps) < total * 0.9) {
      const others = v.filter(l => !best.laps.includes(l));
      const contrast = avgPace(others) - avgPace(best.laps) >= 20;
      const bHr = avgHr(best.laps), oHr = avgHr(others);
      const hrOk = opts.zones?.marathon && bHr ? bHr >= opts.zones.marathon[0] : bHr && oHr ? bHr - oHr >= 5 : true;
      if (contrast && hrOk) {
        const primary = total <= 16000 || sumD(best.laps) >= total * 0.35;  // 긴 러닝 끝부분만 빠르면 '빠른 마무리'로 설명만
        return {
          type: '템포런', primary,
          text: `${primary ? '템포 구간' : '빠른 구간 포함(빌드업/빠른 마무리)'} ${(sumD(best.laps) / 1000).toFixed(1)}km @ ${secToPaceStr(avgPace(best.laps))}/km${bHr ? `, 심박 ${bHr}` : ''}` +
            ` (나머지 ${secToPaceStr(avgPace(others))}/km)`,
          stats: { workPaceSec: avgPace(best.laps), workHr: bHr, repSec: best.laps.reduce((s, l) => s + l.moving_time, 0), isHill: false }
        };
      }
    }
  }
  return null;
}

// 러닝 강도 분류 — 현재 마라톤 페이스(mpSec) 기준. 랩이 있으면 워크아웃 구조(인터벌·언덕 반복·템포) 먼저 감지
function classifyRunIntensity(a, mpSec, zones, laps) {
  const km = a.distance / 1000;
  if (!a.distance || !a.moving_time) return '이지런';
  const p = a.moving_time / km;
  if (km < 3) return '이지런';
  if (km >= 38) return '풀코스';  // 대회급 거리 — 훈련 분류와 구분
  const structure = detectWorkoutStructure(laps, mpSec, { distance: a.distance, zones });
  if (structure?.primary) return structure.type;
  // 쉬지 않고 쭉 빠르게 달린 건 '템포런'(지속주). '인터벌'은 랩에서 질주↔회복 반복이 확인될 때만 (위 구조 감지)
  if (p <= mpSec - 12 && km <= 16) return '템포런';
  if (p <= mpSec + 8 && km >= 6) return '페이스주';
  const hr = a.avg_heartrate || a.average_heartrate;
  if (zones && hr && hr >= zones.threshold[0] && km <= 16) return '템포런';
  if (km >= 20) return 'LSD';
  if (km >= 15) return '롱런';
  return '이지런';
}

// 현재 마라톤 페이스(레이스 환산) — 최근 풀코스 > 풀 PR > 하프 PR(리겔 환산) > 이지런 기반 추정
function estimateCurrentMP(goal, runs) {
  const sixMonths = Date.now() - 183 * 86400000;
  const races = runs.filter(a => a.distance >= 38000 && utcMs(a.start_date) > sixMonths);
  if (races.length) {
    const best = races.reduce((x, y) => (y.moving_time / y.distance < x.moving_time / x.distance ? y : x));
    return { sec: best.moving_time / (best.distance / 1000), source: `최근 풀코스(${kstLabel(best.start_date)}) 실제 페이스` };
  }
  const full = prTimeToSec(goal?.pr_full);
  if (full !== Infinity) return { sec: full / 42.195, source: `풀코스 PR ${goal.pr_full}` };
  const half = prTimeToSec(goal?.pr_half);
  if (half !== Infinity) return { sec: half * Math.pow(2, 1.06) / 42.195, source: `하프 PR ${goal.pr_half} 환산` };
  const easy = runs.filter(a => a.distance >= 5000 && a.distance < 20000).map(a => a.moving_time / (a.distance / 1000));
  if (easy.length >= 5) return { sec: median(easy) - 60, source: '최근 러닝 페이스 기반 추정 (레이스 기록 없음)' };
  const gp = goalPaceSec(goal) || 360;
  return { sec: gp + 30, source: '데이터 부족 — 목표 페이스 기반 임시값' };
}

// 현재 마라톤 페이스 기준 훈련 페이스 (Daniels 기준 근사)
function calcTrainingPaces(mpSec) {
  const r = (a, b) => `${secToPaceStr(mpSec + a)}-${secToPaceStr(mpSec + b)}`;
  return {
    recovery: r(80, 100), easy: r(45, 75), marathon: r(-5, 5),
    tempo: r(-20, -12), interval: r(-40, -32),
    text: `회복 ${r(80, 100)} | 이지·LSD ${r(45, 75)} | 페이스주 ${r(-5, 5)} | 템포런 ${r(-20, -12)} | 인터벌(반복) ${r(-40, -32)} (/km)`
  };
}

// 개인화 주간 목표 — 최근 '정상 훈련 주' 4개의 중앙값 × 훈련 단계 계수 (최대 +10%)
// 대회 주·대회 후 14일 회복 주는 기준에서 제외 (포함하면 목표가 계속 낮아지는 악순환), 대회 거리 자체도 훈련량에서 제외
function weeklyTargetFromRuns(runs, goal, anchorMs = Date.now()) {
  const thisWs = getWeekStart(anchorMs);
  const races = runs.filter(r => r.distance >= 38000).map(r => utcMs(r.start_date));
  const wk = {};
  runs.forEach(r => { if (r.distance >= 38000) return; const w = getWeekStart(r.start_date); wk[w] = (wk[w] || 0) + r.distance / 1000; });
  const weeks = [];
  for (let i = 1; i <= 8; i++) {
    const ws = ymd(new Date(Date.parse(thisWs + 'T00:00:00Z') - i * 7 * 86400000));
    const wsMs = Date.parse(ws + 'T00:00:00Z') - KST_MS;
    const postRace = races.some(t => wsMs < t + 14 * 86400000 && wsMs + 7 * 86400000 > t);
    weeks.push({ ws, km: Math.round((wk[ws] || 0) * 10) / 10, postRace });
  }
  const phase = getTrainingPhase(goal?.race_date);
  const daysLeft = goal?.race_date ? Math.ceil((new Date(goal.race_date) - anchorMs) / 86400000) : null;
  const lastRace = races.length ? Math.max(...races) : null;
  const postRaceNow = lastRace !== null && anchorMs - lastRace >= 0 && anchorMs - lastRace < 14 * 86400000;
  const valid = weeks.filter(w => !w.postRace).slice(0, 4);
  if (valid.filter(w => w.km > 0).length < 2) {
    return { km: getWeeklyTarget(phase), basis: '훈련 단계 기본값 (최근 기록 부족)', weeks: weeks.slice(0, 4) };
  }
  const base = median(valid.map(w => w.km));
  const factor = postRaceNow ? 0.6
    : daysLeft === null || daysLeft < 0 ? 1.0
    : { 기초체력기: 1.05, 훈련강화기: 1.08, 피크훈련기: 1.10, 테이퍼링기: 0.75, 레이스준비기: 0.55 }[phase] || 1.0;
  const km = Math.max(10, Math.round(Math.min(base * factor, base * 1.10)));
  const why = postRaceNow ? '풀코스 후 회복 주간' : daysLeft === null || daysLeft < 0 ? '대회 없음 — 현재 수준 유지' : phase;
  return {
    km, weeks: weeks.slice(0, 4),
    basis: `최근 정상 훈련 주 ${valid.length}개 중앙값 ${base.toFixed(1)}km × ${why}${weeks.slice(0, 8).some(w => w.postRace) ? ', 대회·회복 주 제외' : ''}`
  };
}

// 모든 분석이 공유하는 선수 기준값 (DB 기반 — Strava 호출 없음)
async function buildCoachBasics(userId, goal, anchor = Date.now()) {
  const ctx = getDateContext(anchor);
  const runs = uniqueByStravaId(await sbGet('activities',
    `user_id=eq.${userId}&${RUN_SPORTS}&start_date=gte.${new Date(anchor - 183 * 86400000).toISOString()}` +
    `&select=strava_id,name,distance,moving_time,start_date,avg_heartrate,total_elevation_gain,workout_type,sport_type&order=start_date.desc&limit=600`));
  const apRows = await sbGet('athlete_profiles', `user_id=eq.${userId}&select=summary,metrics`);
  const ap = Array.isArray(apRows) ? apRows[0] : null;
  const zones = ap?.metrics?.hrZones || null;

  const mp = estimateCurrentMP(goal, runs);
  const paces = calcTrainingPaces(mp.sec);
  const goalMpSec = goalPaceSec(goal);
  const phase = getTrainingPhase(goal?.race_date);
  const daysLeft = goal?.race_date ? Math.ceil((new Date(goal.race_date) - anchor) / 86400000) : null;

  // 최근 풀코스 후 회복 기간 여부
  const lastRace = runs.find(a => a.distance >= 38000);
  const daysSinceRace = lastRace ? Math.floor((anchor - utcMs(lastRace.start_date)) / 86400000) : null;
  const postRace = daysSinceRace !== null && daysSinceRace >= 0 && daysSinceRace < 14;

  // 개인화 주간 목표 (대회·회복 주 제외한 정상 훈련 주 기준)
  const weeklyTarget = weeklyTargetFromRuns(runs, goal, anchor);
  const last4 = weeklyTarget.weeks;
  const clubRuns = await fetchClubRuns(anchor);

  return {
    userId, ctx, runs, byId: new Map(runs.map(r => [String(r.strava_id), r])), zones, mp, paces, goalMpSec, phase, daysLeft, postRace, daysSinceRace, lastRace,
    last4Weeks: last4, weeklyTarget, clubRuns, athleteNote: ap?.summary || '',
    refPaceStr: secToPaceStr(mp.sec)
  };
}

// 프롬프트 공통 블록 (선수 기준값 + 코칭 원칙)
function coachBasicsBlock(b) {
  const gap = b.goalMpSec ? Math.round(b.mp.sec - b.goalMpSec) : null;
  return `[현재 실력 기준]
- 현재 마라톤 페이스(레이스 환산): ${b.refPaceStr}/km — 근거: ${b.mp.source}
${b.goalMpSec ? `- 목표 레이스 페이스: ${secToPaceStr(b.goalMpSec)}/km (현재 대비 ${gap > 0 ? `${gap}초/km 더 빨라야 함` : `${-gap}초/km 여유`}) — 목표는 비교용이며 처방 기준이 아님` : ''}
[현재 실력 기준 훈련 페이스] ${b.paces.text}
${b.zones ? `[심박 구간] ${hrZonesText(b.zones)}` : '[심박 구간] 미설정 — 페이스 기준으로만 평가'}
[주간 목표 거리] ${b.weeklyTarget.km}km (${b.weeklyTarget.basis}) | 최근 4주: ${b.last4Weeks.slice().reverse().map(w => `${w.km}${w.postRace ? '*' : ''}`).join(' → ')}km (*=대회·회복 주, 대회 거리 제외)
${b.postRace ? `⚠️ 풀코스(${kstLabel(b.lastRace.start_date)}) 후 ${b.daysSinceRace}일째 — 회복 기간\n` : ''}${clubRunsText(b.clubRuns, b.mp?.sec)}
${b.clubRuns?.length ? COACHING_RULES.replace('8. 일요일은 일산호수 정모 LSD 고정 — 거리가 아니라 시간 기준으로 처방(예: LSD 2시간, 이 선수 LSD 페이스로 약 OOkm는 괄호로).', '8. [일마 정모 일정]에 있는 날은 그 종류·시간(또는 거리)·코스를 그대로 처방(페이스·심박은 선수 기준값). 시간 기준이면 시간으로 처방하고 예상 거리는 괄호로, 주간 거리 계산에는 표의 예상 거리를 사용. 일정에 없는 일요일은 일산호수 정모 LSD(시간 기준).') : COACHING_RULES}
`;
}

// 심박이 어느 구간인지
// 반복·템포 구간 강도 판정 — AI가 범위 비교를 직접 하지 않도록 코드에서 결론을 내려 전달
function structureVerdict(structure, basics) {
  const st = structure?.stats;
  if (!st || !structure.primary || !basics?.mp?.sec) return '';
  const mp = basics.mp.sec;
  const isTempo = structure.type === '템포런';
  const [lo, hi] = isTempo ? [mp - 20, mp - 12] : [mp - 40, mp - 32];   // 기준 범위 (초/km, 작을수록 빠름)
  const rangeStr = `${secToPaceStr(lo)}~${secToPaceStr(hi)}/km`;
  const judge = (sec) => sec < lo ? `기준보다 ${Math.round(lo - sec)}초/km 빠름`
    : sec > hi ? `기준보다 ${Math.round(sec - hi)}초/km 느림` : '기준 범위 안 (충족)';
  const lines = [];
  if (st.isHill) {
    lines.push(`- 페이스: 오르막 반복(평균 경사 약 ${st.gradePct}%)이라 평지 인터벌 페이스 기준(${rangeStr})과 비교하지 않음. 실제 반복 평균 ${secToPaceStr(st.workPaceSec)}/km는 참고용, 강도는 심박과 반복 간 일관성으로 판단`);
  } else {
    lines.push(`- 페이스: 반복 평균 ${secToPaceStr(st.workPaceSec)}/km → ${isTempo ? '템포' : '인터벌'} 기준 ${rangeStr} 대비 ${judge(st.workPaceSec)}`);
  }
  if (st.workHr && basics.zones) {
    const target = isTempo ? basics.zones.threshold : basics.zones.interval;
    const zoneLabel = hrZoneOf(st.workHr, basics.zones);
    let hrLine = `- 심박: 반복 평균 ${st.workHr}bpm → ${zoneLabel}${target ? ` (목표 구간 ${target[0]}~${target[1]}bpm ${st.workHr >= target[0] ? '도달' : '미도달'})` : ''}`;
    if (!isTempo && st.repSec < 240) hrLine += ` · 반복 1회가 약 ${Math.round(st.repSec / 60 * 10) / 10}분으로 짧아 심박이 다 오르기 전에 끝남 → 랩 평균 심박이 목표보다 낮은 건 정상${st.isHill ? (st.recHr ? `. 반복 ${st.workHr} vs 회복 ${st.recHr}bpm (+${st.workHr - st.recHr}) → ${st.workHr - st.recHr >= 10 ? '오르막에서 확실히 힘을 씀' : '반복과 회복의 강도 차이가 작음'}` : '') : ', 강도는 페이스로 판단'}`;
    lines.push(hrLine);
  }
  if (st.firstPaceSec && st.lastPaceSec && !isTempo) {
    const d = Math.round(st.lastPaceSec - st.firstPaceSec);
    lines.push(`- 일관성: 첫 반복 ${secToPaceStr(st.firstPaceSec)} → 마지막 ${secToPaceStr(st.lastPaceSec)}/km (${d > 0 ? `${d}초 느려짐` : d < 0 ? `${-d}초 빨라짐` : '같음'}) → ${Math.abs(d) <= 8 ? '일정하게 유지' : d > 20 ? '후반 페이스가 크게 떨어짐' : d > 0 ? '후반 약간 떨어짐' : '후반으로 갈수록 빨라짐'}${st.isHill ? ' (언덕 반복은 구간마다 경사가 달라 참고용)' : ''}`);
  }
  return lines.length ? `[강도 판정 — 코드 계산 결과]\n${lines.join('\n')}\n` : '';
}

function hrZoneOf(hr, zones) {
  if (!hr || !zones) return null;
  const order = ['easy', 'marathon', 'threshold', 'interval'];
  const labels = zones.labels || HR_ZONE_LABEL;
  if (hr < zones.easy[0]) return '회복(이지 구간 아래)';
  for (const k of order) if (hr <= zones[k][1]) return labels[k];
  return labels.interval;
}

// 심박당 속도 효율 (m/분 ÷ bpm) — 같은 심박에서 더 빨라지면 상승 = 유산소 체력 향상
function efficiency(a) {
  const hr = a.avg_heartrate || a.average_heartrate;
  if (!hr || !a.moving_time) return null;
  return (a.distance / (a.moving_time / 60)) / hr;
}

// 같은 유형 과거 비교 (지난 8주, 오늘 활동 제외)
function sameTypeComparison(activity, workoutType, basics, anchorMs) {
  const from = anchorMs - 56 * 86400000;
  const past = basics.runs.filter(r =>
    String(r.strava_id) !== String(activity.id) && r.sport_type === '러닝' &&
    utcMs(r.start_date) < anchorMs && utcMs(r.start_date) >= from &&
    runType(r, basics) === workoutType);
  if (past.length < 2) return `같은 유형(${workoutType}) 지난 8주 기록 ${past.length}회 — 비교 불가`;
  const paceOf = (r) => r.moving_time / (r.distance / 1000);
  const medPace = median(past.map(paceOf));
  const hrs = past.map(r => r.avg_heartrate).filter(Boolean);
  const todayHr = activity.average_heartrate || null;
  const todayPace = activity.moving_time / (activity.distance / 1000);
  let line = `같은 유형(${workoutType}) 지난 8주 ${past.length}회 중앙값: ${secToPaceStr(medPace)}/km` +
    (hrs.length ? ` · ${Math.round(median(hrs))}bpm` : '') +
    ` · ${(median(past.map(r => r.distance)) / 1000).toFixed(1)}km → 오늘 ${secToPaceStr(todayPace)}/km` +
    (todayHr ? ` · ${Math.round(todayHr)}bpm` : '') + ` · ${(activity.distance / 1000).toFixed(1)}km`;
  const effs = past.map(efficiency).filter(Boolean);
  const todayEff = efficiency(activity);
  if (effs.length >= 2 && todayEff) {
    const diff = (todayEff / median(effs) - 1) * 100;
    line += `\n심박당 속도 효율: 지난 8주 대비 ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}% (±3% 이내는 평소 수준, +면 같은 심박에서 더 빠름)`;
    // 8주를 앞·뒤 4주로 나눈 추세
    const mid = anchorMs - 28 * 86400000;
    const older = past.filter(r => utcMs(r.start_date) < mid).map(efficiency).filter(Boolean);
    const recent = past.filter(r => utcMs(r.start_date) >= mid).map(efficiency).filter(Boolean);
    if (older.length >= 2 && recent.length >= 2) {
      const t = (median(recent) / median(older) - 1) * 100;
      line += `\n효율 추세: 5~8주 전 대비 최근 4주 ${t >= 0 ? '+' : ''}${t.toFixed(1)}%`;
    }
  }
  return line;
}

// 최근 14일 러닝 기록 (오늘 이전)
function recentLog(basics, anchorMs, activityId) {
  const from = anchorMs - 14 * 86400000;
  const rows = basics.runs
    .filter(r => String(r.strava_id) !== String(activityId) && utcMs(r.start_date) < anchorMs && utcMs(r.start_date) >= from)
    .sort((x, y) => utcMs(x.start_date) - utcMs(y.start_date));
  if (!rows.length) return { text: '최근 14일 러닝 기록 없음', lastHardDays: null };
  let lastHard = null;
  const text = rows.map(r => {
    const t = runType(r, basics);
    if (QUALITY_TYPES.includes(t) || r.distance >= 20000) lastHard = r;
    return `- ${kstLabel(r.start_date)} ${t} ${(r.distance / 1000).toFixed(1)}km @ ${secToPaceStr(r.moving_time / (r.distance / 1000))}` +
      (r.avg_heartrate ? ` · ${Math.round(r.avg_heartrate)}bpm` : '');
  }).join('\n');
  // 달력 날짜(KST) 기준 경과일 — 토요일 저녁 → 일요일 아침이면 '1일 전'
  const dayNo = (t) => Math.floor(Date.parse(ymd(toKst(t)) + 'T00:00:00Z') / 86400000);
  const lastHardDays = lastHard ? dayNo(anchorMs) - dayNo(lastHard.start_date) : null;
  return { text, lastHardDays, lastHardLabel: lastHard ? kstLabel(lastHard.start_date) : null };
}

// 주간 계획(weekly_plans) 중 남은 요일 텍스트
async function plannedDaysText(userId, weekStart, labels) {
  try {
    const rows = await sbGet('weekly_plans', `user_id=eq.${userId}&week_start=eq.${weekStart}`);
    const plan = Array.isArray(rows) ? rows[0] : null;
    if (!plan || !labels.length) return '';
    const keyOf = { '월': 'mon', '화': 'tue', '수': 'wed', '목': 'thu', '금': 'fri', '토': 'sat', '일': 'sun' };
    const items = labels.map(l => {
      const d = l.match(/\((.)\)/)?.[1];
      return plan[keyOf[d]] ? `${l} ${plan[keyOf[d]]}` : null;
    }).filter(Boolean);
    return items.length ? items.join(', ') : '';
  } catch (e) { return ''; }
}

async function analyzeDailyActivity(activity, goal, basics, workoutType, sportType, phases, details, weather, condition, coachingNote) {
  const anchorMs = utcMs(activity.start_date);
  const ctx = getDateContext(anchorMs);
  const km = (activity.distance / 1000).toFixed(1);
  const pace = calcPace(activity.moving_time, activity.distance);
  const isCross = isCrossTraining(sportType);
  const isTrail = sportType === '트레일런';
  const adjustedPace = isTrail ? calcAdjustedPace(activity.moving_time, activity.distance, activity.total_elevation_gain) : pace;

  // 심박/케이던스
  const hrData = details?.streams?.heartrate?.data || [];
  const cadData = details?.streams?.cadence?.data || [];
  const avgHR = hrData.length > 0 ? Math.round(hrData.reduce((s, v) => s + v, 0) / hrData.length) : (activity.average_heartrate ? Math.round(activity.average_heartrate) : null);
  const avgCad = cadData.length > 0 ? Math.round(cadData.reduce((s, v) => s + v, 0) / cadData.length * 2) : null;
  const zoneName = hrZoneOf(avgHR, basics.zones);

  // 이번 주 진행 (활동일 기준 주, 오늘 활동 포함)
  const weekRuns = basics.runs.filter(r => getWeekStart(r.start_date) === ctx.weekStart &&
    utcMs(r.start_date) < anchorMs && String(r.strava_id) !== String(activity.id));
  const weekKm = weekRuns.reduce((s, r) => s + r.distance, 0) / 1000 + (isCross ? 0 : activity.distance / 1000);
  const weekQuality = weekRuns.filter(r => QUALITY_TYPES.includes(runType(r, basics))).length
    + (QUALITY_TYPES.includes(workoutType) ? 1 : 0);

  const log = recentLog(basics, anchorMs, activity.id);
  const comparison = isCross ? '' : sameTypeComparison({ ...activity, average_heartrate: avgHR }, workoutType, basics, anchorMs);

  // 처방 대상 날짜: 일요일이면 다음 주 월~수, 아니면 이번 주 남은 날
  const isSunday = ctx.todayDow === 0;
  const targetLabels = isSunday ? ctx.nextWeekLabels.slice(0, 3) : ctx.remainingDayLabels;
  const planned = await plannedDaysText(basics.userId, isSunday ? ctx.nextWeekStart : ctx.weekStart, targetLabels);
  const lateNote = Date.now() - anchorMs > 36 * 3600000 ? ` (훈련 ${Math.floor((Date.now() - anchorMs) / 86400000)}일 뒤 늦게 분석됨)` : '';

  // 인터벌·언덕 반복·템포는 전체 평균이 아니라 반복 구간이 핵심 → 구조를 그대로 전달
  const structure = isCross ? null : detectWorkoutStructure(details?.laps, basics.mp.sec, { distance: activity.distance, zones: basics.zones });
  const phaseInfo = structure
    ? `워크아웃 구조: ${structure.text}`
    : phases
      ? `웜업 ${phases.warmupKm}km · 본훈련 ${phases.mainKm}km @ ${phases.mainPace}/km · 쿨다운 ${phases.cooldownKm}km | ${phases.splitText} | 랩 페이스 편차 ±${phases.paceSdSec}초`
      : '랩 데이터 없음';
  const verdict = structureVerdict(structure, basics);
  const weatherImpact = weather ? analyzeWeatherImpact(weather) : null;
  const conditionInfo = condition
    ? `컨디션 ${condition.condition || '보통'} | 부상 ${condition.injury_part || '없음'}${condition.injury_part && condition.injury_part !== '없음' ? ` (${condition.injury_level})` : ''}${condition.memo ? ` | 메모: ${condition.memo}` : ''}`
    : '';

  const prompt = `마라톤 코치로서 오늘 훈련의 일일 분석을 작성하세요. 선수는 텔레그램으로 읽습니다.

📅 훈련일: ${ctx.todayLabel}${lateNote} | 이번 주 ${ctx.weekRange} 중 ${ctx.weekDayNum}일차
선수 목표: ${goal?.race_name || '마라톤'} ${goal?.target_time || ''} | D-${basics.daysLeft ?? '?'} | ${basics.phase}
PR: 풀 ${goal?.pr_full || '-'} / 하프 ${goal?.pr_half || '-'} / 10K ${goal?.pr_10k || '-'}

${coachBasicsBlock(basics)}${athleteNoteBlock(basics.athleteNote)}${coachingNote ? `\n📝 최근 코치 조언 (이행 여부 확인): ${String(coachingNote).slice(0, 400)}\n` : ''}
[오늘 운동]
- ${sportType} / 분류: ${workoutType} (현재 실력 기준 자동 분류)
- ${km}km · ${Math.floor(activity.moving_time / 60)}분 · ${pace}/km${isTrail ? ` (고도 환산 ${adjustedPace}/km)` : ''} · 고도 ${Math.round(activity.total_elevation_gain || 0)}m
${avgHR ? `- 평균 심박 ${avgHR}bpm → ${zoneName || '구간 미설정'}` : '- 심박 데이터 없음'}${avgCad ? ` | 케이던스 ${avgCad}spm` : ''}
- 구간: ${phaseInfo}
${weatherImpact ? `- 날씨: ${weatherImpact.replace(/\n/g, ' / ')}` : ''}
${conditionInfo ? `- 선수 컨디션: ${conditionInfo}` : ''}

${verdict}${comparison ? `[같은 유형 과거 비교]\n${comparison}\n` : ''}
[최근 14일 러닝]${log.lastHardDays !== null ? ` (마지막 강훈련: ${log.lastHardDays === 0 ? '같은 날' : `${log.lastHardDays}일 전`} ${log.lastHardLabel})` : ''}
${log.text}

[이번 주] 오늘 포함 ${weekKm.toFixed(1)}km / 주간 목표 ${basics.weeklyTarget.km}km · 강훈련 ${weekQuality}회
${planned ? `[주간 리포트 계획] ${planned}` : '[주간 리포트 계획] 없음'}

아래 4개 섹션으로 900자 이내 작성:

**오늘 평가**
${structure?.primary
  ? `이 훈련은 ${structure.type}입니다. 전체 평균 페이스·심박이 아니라 [워크아웃 구조]의 반복(질주) 구간 페이스와 심박이 의도한 강도(${structure.type === '템포런' ? '젖산역치·템포' : '인터벌·역치 이상'} 구간)에 맞았는지, 첫 반복과 마지막 반복의 페이스 차이(일관성)를 평가하세요. 회복 구간이 충분히 느렸는지도 한 줄로.${verdict ? ' 페이스·심박·일관성은 [강도 판정]의 결론을 그대로 따르고 숫자를 인용하세요. 판정과 다르게 쓰지 말 것(예: "기준 범위 안"인 값을 느리다·빠르다고 쓰지 말 것).' : ''}`
  : `훈련 분류(${workoutType})의 의도에 맞는 강도였는지 심박 구간과 페이스로 판단하세요.`} ${comparison && !comparison.includes('비교 불가') ? '[같은 유형 과거 비교]의 숫자를 최소 1개 인용해 지난 기록 대비 변화를 평가하세요.' : '같은 유형 과거 기록이 부족하니 과거 비교는 하지 말 것.'} ${phases && !structure?.primary ? '스플릿·페이스 편차도 한 줄로.' : ''}${isCross ? ' 크로스트레이닝이 마라톤 준비에 주는 효과 중심으로.' : ''}${isTrail ? ' 트레일은 고도 환산 페이스 기준.' : ''}${weatherImpact ? ' 날씨 영향이 컸다면 반영.' : ''}${condition?.injury_part && condition.injury_part !== '없음' ? ` ${condition.injury_part} 부상을 반드시 고려.` : ''} (3-4문장)

**이번 주 흐름**
주간 목표 대비 진행과 강도 분포, 최근 강훈련 간격을 1-2문장으로.

**남은 훈련 처방**
${isSunday ? `이번 주는 오늘로 끝났습니다. 다음 주 초반 ${targetLabels.join(', ')}만 처방하세요 (전체 주간 계획은 월요일 주간 리포트에서 제공).` : targetLabels.length ? `남은 날 ${targetLabels.join(', ')}를 처방하세요.` : '남은 날이 없습니다.'}
${planned ? '주간 리포트 계획을 기본으로 따르되, 오늘 결과 때문에 바꿀 게 있으면 이유를 한 줄로 밝히세요.' : ''}
${targetLabels.length ? `형식: "- ${targetLabels[0]} 훈련종류 거리km @ 페이스/km, 심박 범위" 처럼 한 줄씩. 휴식일도 표시.` : ''}

**코치 한마디**
1문장.`;

  return callClaude(prompt, 1100);
}

// ══════════════════════════════════════
// 주간 분석 (2000자 이내) — S2+S3+S5+A1 통합
// ══════════════════════════════════════
// 최근 4주(완료된 주) 흐름 — 거리, 강훈련, 이지 강도 비율, 이지런 효율
function weekTrendText(basics) {
  const lines = [];
  const effs = [];
  for (let i = 4; i >= 1; i--) {
    const ws = ymd(new Date(Date.parse(basics.ctx.weekStart + 'T00:00:00Z') - i * 7 * 86400000));
    const wr = basics.runs.filter(r => getWeekStart(r.start_date) === ws);
    if (!wr.length) { lines.push(`- ${dateLabel(ws)}~ 주: 러닝 없음`); effs.push(null); continue; }
    const km = wr.reduce((s, r) => s + r.distance, 0) / 1000;
    const cls = wr.map(r => runType(r, basics));
    const q = cls.filter(c => QUALITY_TYPES.includes(c)).length;
    const longest = Math.max(...wr.map(r => r.distance)) / 1000;
    let easyShare;
    const withHr = wr.filter(r => r.avg_heartrate);
    if (basics.zones && withHr.length) {
      const tot = withHr.reduce((s, r) => s + r.moving_time, 0);
      easyShare = Math.round(withHr.filter(r => r.avg_heartrate <= basics.zones.easy[1]).reduce((s, r) => s + r.moving_time, 0) / tot * 100);
    } else {
      const tot = wr.reduce((s, r) => s + r.moving_time, 0);
      easyShare = Math.round(wr.filter((r, i) => !QUALITY_TYPES.includes(cls[i])).reduce((s, r) => s + r.moving_time, 0) / tot * 100);
    }
    const easyEffs = wr.filter((r, i) => !QUALITY_TYPES.includes(cls[i])).map(efficiency).filter(Boolean);
    const eff = easyEffs.length ? median(easyEffs) : null;
    effs.push(eff);
    lines.push(`- ${dateLabel(ws)}~ 주: ${km.toFixed(1)}km · ${wr.length}회 · 최장 ${longest.toFixed(1)}km · 강훈련 ${q}회 · 이지 강도 비율 ${easyShare}%`);
  }
  const valid = effs.filter(Boolean);
  if (valid.length >= 2) {
    const first = effs.find(Boolean), last = [...effs].reverse().find(Boolean);
    const t = (last / first - 1) * 100;
    lines.push(`이지런 심박당 속도 효율: 4주 전 대비 ${t >= 0 ? '+' : ''}${t.toFixed(1)}% (±3% 이내는 변화 없음 수준)`);
  }
  return lines.join('\n');
}

function actLine(a, basics) {
  const st = getSportType(a);
  const wt = isCrossTraining(st) ? st : labelOf(a, basics);
  const hr = a.average_heartrate ? ` · ${Math.round(a.average_heartrate)}bpm` : '';
  const adj = st === '트레일런' ? ` (환산 ${calcAdjustedPace(a.moving_time, a.distance, a.total_elevation_gain)})` : '';
  return `- ${kstLabel(a.start_date)} ${st}/${wt} ${(a.distance / 1000).toFixed(1)}km @ ${calcPace(a.moving_time, a.distance)}/km${adj}${hr}`;
}

async function analyzeWeekly(userId, goal, accessToken) {
  const basics = await buildCoachBasics(userId, goal);
  const ctx = basics.ctx;
  const refPace = basics.refPaceStr;
  const weeklyTarget = basics.weeklyTarget.km;

  // 이번 주 (월요일 00:00 KST ~ 현재) — Strava에서 최신으로
  const thisWeekAfter = Math.floor(Date.parse(ctx.weekStart + 'T00:00:00+09:00') / 1000);
  const thisWeekRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${thisWeekAfter}&per_page=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  ).then(r => r.json());
  const thisWeekActs = Array.isArray(thisWeekRes) ? thisWeekRes : [];

  // 지난 주 (월~일)
  const lastWeekStart = thisWeekAfter - 7 * 86400;
  const lastWeekRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${lastWeekStart}&before=${thisWeekAfter}&per_page=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  ).then(r => r.json());
  const lastWeekActs = Array.isArray(lastWeekRes) ? lastWeekRes : [];
  const lastWeekRunKm = lastWeekActs.filter(a => ['러닝', '트레일런'].includes(getSportType(a)))
    .reduce((s, a) => s + a.distance, 0) / 1000;

  const prevCoachingNote = await fetchCoachingNote(userId, 'weekly');
  const planComparison = await fetchWeeklyPlanComparison(userId, ctx.weekStart, thisWeekActs, refPace, ctx, basics.zones, basics);
  const kpi = calcWeeklyKPI(thisWeekActs, weeklyTarget, refPace, basics.zones, basics);

  // 처방 범위: 일요일 → 다음 주 전체 / 그 외 → (오늘 아직 안 뛰었으면 오늘부터) 남은 날, 남은 날이 2일 이하면 다음 주까지
  const ranToday = thisWeekActs.some(a => ymd(toKst(a.start_date)) === ctx.today);
  let planDates, planTitle;
  if (ctx.todayDow === 0) {
    planDates = ctx.nextWeekDates;
    planTitle = `다음 주 계획 (${dateLabel(planDates[0])} ~ ${dateLabel(planDates[6])})`;
  } else {
    const thisWeek = (ranToday ? [] : [ctx.today]).concat(ctx.remainingDayDates);
    planDates = thisWeek.length <= 2 ? thisWeek.concat(ctx.nextWeekDates) : thisWeek;
    planTitle = thisWeek.length <= 2 ? '이번 주 남은 계획 + 다음 주 계획' : `이번 주 계획 (${dateLabel(thisWeek[0])} ~ 일요일)`;
  }
  const thisWeekLeftKm = Math.max(0, weeklyTarget - parseFloat(kpi.totalKm));

  const prompt = `마라톤 코치로서 주간 리포트를 작성하세요. 선수는 텔레그램으로 읽습니다.

📅 작성일: ${ctx.todayLabel} | 이번 주 ${ctx.weekRange} 중 ${ctx.weekDayNum}일차
선수 목표: ${goal?.race_name || '마라톤'} ${goal?.target_time || ''} | D-${basics.daysLeft ?? '?'} | ${basics.phase}
PR: 풀 ${goal?.pr_full || '-'} / 하프 ${goal?.pr_half || '-'} / 10K ${goal?.pr_10k || '-'}

${coachBasicsBlock(basics)}${athleteNoteBlock(basics.athleteNote)}${prevCoachingNote ? `\n📝 지난 주 코치 조언 (이행 여부 평가할 것):\n${String(prevCoachingNote).slice(0, 700)}\n` : ''}
[지난 주 기록] 러닝 ${lastWeekRunKm.toFixed(1)}km
${lastWeekActs.map(a => actLine(a, basics)).join('\n') || '기록 없음'}

[최근 4주 흐름]
${weekTrendText(basics)}

[이번 주 지금까지] ${kpi.summary}
${thisWeekActs.map(a => actLine(a, basics)).join('\n') || '아직 기록 없음'}
${planComparison ? `\n[이번 주 계획 대비 실행] 이행 ${planComparison.completedCount}/${planComparison.totalCount}\n${planComparison.text}` : ''}

아래 순서로 2000자 이내 작성:

**지난 주 평가**
거리·강도 분포·롱런을 숫자로 평가. ${prevCoachingNote ? '지난 코치 조언의 이행 여부를 반드시 언급. ' : ''}잘한 점 1개 이상 구체적으로. (3-4문장)

**최근 4주 흐름**
거리 추세, 이지 강도 비율, 효율 변화가 의미하는 것을 2-3문장으로. 효율 변화가 ±3% 이내면 "유지"로 해석.

**${planTitle}**
${planDates.map(dateLabel).join(', ')} 각각 한 줄씩 "- ${dateLabel(planDates[0])} 훈련종류 거리km @ 페이스/km, 심박 범위" 형식. 휴식일도 표시.
이번 주 남은 날의 합계는 ${thisWeekLeftKm.toFixed(0)}km 이하(이미 ${kpi.totalKm}km 완료), 다음 주는 ${weeklyTarget}km 이하. 강훈련은 주 2회 이하, 연속 금지, 일요일은 일산호수 LSD(시간 기준).

**핵심 훈련 상세**
위 계획 중 가장 중요한 1개: 웜업/본훈련/쿨다운, 페이스·심박, 목적.

**이번 주 핵심 포인트**
2-3개. 약점 프로파일과 연결.
${planBlockInstruction(planDates)}`;

  const raw = await callClaude(prompt, 2300, 'medium');
  const { clean, items } = extractPlan(raw);
  try { await storePlanItems(userId, items); } catch (e) { console.error('plan store error:', e.message); }

  // A1: 이번 주 코칭 노트 저장 (다음 주에 활용)
  await saveCoachingNote(userId, 'weekly', ctx.weekStart, clean);
  return clean;
}

// ── 주간 계획: 리포트 끝의 <PLAN> 블록을 코드가 직접 읽어 정확한 주에 저장 ──
const PLAN_TYPES = ['인터벌', '템포런', '페이스주', 'LSD', '롱런', '이지런', '회복런', '언덕훈련', '트레일런', '수영', '자전거', '근력훈련', '휴식'];

function dateLabel(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW_KO[d.getUTCDay()]})`;
}
function weekStartOfDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return ymd(d);
}

function planBlockInstruction(dates) {
  return `
마지막에 아래 형식의 계획 블록을 반드시 붙이세요 (선수에게는 보이지 않는 저장용). 위에서 처방한 날짜만, 한 줄에 하나:
<PLAN>
${dates.map(d => `${d}|훈련종류`).join('\n')}
</PLAN>
훈련종류는 ${PLAN_TYPES.join('/')} 중 하나만.`;
}

function normalizePlanType(t) {
  const v = String(t || '').trim();
  if (PLAN_TYPES.includes(v)) return v;
  const hit = PLAN_TYPES.find(p => v.includes(p));
  if (hit) return hit;
  if (/회복|조깅/.test(v)) return '회복런';
  if (/미디움|중간/.test(v)) return '롱런';
  return v.slice(0, 10);
}

// 본문에서 <PLAN> 블록을 떼어내고 {날짜: 훈련} 반환
function extractPlan(analysis) {
  const m = String(analysis || '').match(/<PLAN>([\s\S]*?)<\/PLAN>/i);
  const clean = String(analysis || '').replace(/<PLAN>[\s\S]*?(<\/PLAN>|$)/gi, '').trim();
  const items = {};
  if (m) {
    m[1].split('\n').forEach(line => {
      const [d, t] = line.split('|').map(x => (x || '').trim());
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && t) items[d] = normalizePlanType(t);
    });
  }
  return { clean, items };
}

// 날짜별 계획을 주 단위로 묶어 weekly_plans에 병합 저장 (지정된 요일만 덮어씀)
async function storePlanItems(userId, items) {
  const byWeek = {};
  for (const [d, t] of Object.entries(items)) {
    const ws = weekStartOfDate(d);
    const key = DOW_KEY[new Date(d + 'T00:00:00Z').getUTCDay()];
    (byWeek[ws] = byWeek[ws] || {})[key] = t;
  }
  for (const [ws, days] of Object.entries(byWeek)) {
    const rows = await sbGet('weekly_plans', `user_id=eq.${userId}&week_start=eq.${ws}`);
    const prev = Array.isArray(rows) && rows[0] ? rows[0] : {};
    const row = { user_id: userId, week_start: ws };
    for (const k of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) row[k] = days[k] ?? prev[k] ?? '';
    await sbUpsert('weekly_plans', row, 'user_id,week_start');
  }
  return Object.keys(byWeek);
}

// ══════════════════════════════════════
// 월간 분석 (4000자 이내)
// ══════════════════════════════════════
// 월별 지표 (DB 기반 — Strava 30개 제한 없음)
function monthStats(acts, monthKey, basics) {
  const inMonth = acts.filter(a => ymd(toKst(a.start_date)).slice(0, 7) === monthKey);
  const runs = inMonth.filter(a => ['러닝', '트레일런'].includes(a.sport_type));
  const cross = inMonth.filter(a => !['러닝', '트레일런', '워킹/하이킹'].includes(a.sport_type));
  const cls = runs.map(r => runType(r, basics));
  const km = runs.reduce((s, r) => s + r.distance, 0) / 1000;
  const long = runs.filter(r => r.distance >= 20000 && r.distance < 38000);
  const longest = runs.length ? Math.max(...runs.map(r => r.distance)) / 1000 : 0;
  const quality = cls.filter(c => QUALITY_TYPES.includes(c)).length;
  const weeks = new Set(runs.map(r => getWeekStart(r.start_date))).size;
  const easyEffs = runs.filter((r, i) => r.sport_type === '러닝' && !QUALITY_TYPES.includes(cls[i])).map(efficiency).filter(Boolean);
  const races = runs.filter(r => r.distance >= 38000);
  let easyShare = null;
  const withHr = runs.filter(r => r.avg_heartrate);
  if (basics.zones && withHr.length) {
    const tot = withHr.reduce((s, r) => s + r.moving_time, 0);
    easyShare = Math.round(withHr.filter(r => r.avg_heartrate <= basics.zones.easy[1]).reduce((s, r) => s + r.moving_time, 0) / tot * 100);
  }
  return {
    monthKey, km, runs: runs.length, crossCount: cross.length,
    crossMin: Math.round(cross.reduce((s, a) => s + a.moving_time, 0) / 60),
    longCount: long.length, longest, quality, weeks, easyShare,
    easyEff: easyEffs.length >= 3 ? median(easyEffs) : null,
    races: races.map(r => `${kstLabel(r.start_date)} ${(r.distance / 1000).toFixed(1)}km ${secToPaceStr(r.moving_time / (r.distance / 1000))}/km`)
  };
}

// 다음 달 주차별 권장 거리 — 단계별 증가, 4주차 회복, 테이퍼 반영, 주당 +10% 이내
function monthlyWeekPlan(basics, goal, planMonthStartIso) {
  const start = new Date(planMonthStartIso + 'T00:00:00Z');
  const month = start.getUTCMonth();
  // 1일이 속한 주의 월요일부터 시작, 목요일이 그 달에 속하는 주만 포함 (주가 두 달에 걸칠 때의 표준 기준)
  const d0 = new Date(start); d0.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const inMonth = (mon) => { const th = new Date(mon); th.setUTCDate(mon.getUTCDate() + 3); return th.getUTCMonth() === month; };
  if (!inMonth(d0)) d0.setUTCDate(d0.getUTCDate() + 7);
  const weeks = [];
  let km = basics.weeklyTarget.km;
  for (let i = 0, d = new Date(d0); inMonth(d); i++, d.setUTCDate(d.getUTCDate() + 7)) {
    const daysToRace = goal?.race_date ? Math.ceil((Date.parse(goal.race_date + 'T00:00:00Z') - d.getTime()) / 86400000) : null;
    let target, note = '';
    if (daysToRace !== null && daysToRace < 0 && daysToRace >= -14) { target = Math.round(km * (daysToRace >= -7 ? 0.4 : 0.6)); note = ' (대회 후 회복)'; }
    else if (daysToRace !== null && daysToRace >= 0 && daysToRace <= 7) target = Math.round(km * 0.5);
    else if (daysToRace !== null && daysToRace > 7 && daysToRace <= 21) target = Math.round(km * 0.75);
    else if ((i + 1) % 4 === 0) target = Math.round(km * 0.8);           // 4주차 회복 주
    else { km = i === 0 ? km : Math.round(km * 1.05); target = km; }       // 주당 +5% (상한 10% 이내)
    const end = new Date(d); end.setUTCDate(d.getUTCDate() + 6);
    const tag = note || (daysToRace !== null && daysToRace >= 0 && daysToRace <= 21 ? ` (대회 D-${daysToRace} 테이퍼)` : (i + 1) % 4 === 0 ? ' (회복 주)' : '');
    weeks.push(`${dateLabel(ymd(d))}~${dateLabel(ymd(end))}: ${target}km${tag}`);
  }
  return weeks;
}

async function analyzeMonthly(userId, goal, accessToken) {
  const basics = await buildCoachBasics(userId, goal);
  const ctx = basics.ctx;
  const nowK = toKst(Date.now());

  // 1~7일에 실행되면(월초 정기 리포트) 지난 달 전체를 평가하고 이번 달을 계획
  // 그 외(월 중 수동 실행)에는 이번 달 진행 상황을 평가하고 다음 달을 계획
  const early = nowK.getUTCDate() <= 7;
  const evalDate = new Date(Date.UTC(nowK.getUTCFullYear(), nowK.getUTCMonth() - (early ? 1 : 0), 1));
  const planDate = new Date(Date.UTC(nowK.getUTCFullYear(), nowK.getUTCMonth() + (early ? 0 : 1), 1));
  const evalKey = ymd(evalDate).slice(0, 7);
  const evalLabel = `${evalDate.getUTCMonth() + 1}월${early ? '' : ` (${ctx.today.slice(5).replace('-', '/')}까지 진행 중)`}`;
  const planLabel = `${planDate.getUTCMonth() + 1}월`;

  // 최근 4개월 전체 활동 (러닝 + 크로스)
  const fromIso = new Date(Date.UTC(evalDate.getUTCFullYear(), evalDate.getUTCMonth() - 3, 1) - KST_MS).toISOString();
  const acts = uniqueByStravaId(await sbGet('activities',
    `user_id=eq.${userId}&start_date=gte.${fromIso}&select=strava_id,sport_type,distance,moving_time,start_date,avg_heartrate&order=start_date.asc&limit=1000`));
  const months = [3, 2, 1, 0].map(k => ymd(new Date(Date.UTC(evalDate.getUTCFullYear(), evalDate.getUTCMonth() - k, 1))).slice(0, 7));
  const stats = months.map(m => monthStats(acts, m, basics));
  const ev = stats[3];
  const firstEff = stats.find(x => x.easyEff)?.easyEff;
  const effTrend = firstEff && ev.easyEff ? (ev.easyEff / firstEff - 1) * 100 : null;
  const trendText = stats.map(x =>
    `- ${Number(x.monthKey.slice(5))}월: 러닝 ${x.km.toFixed(0)}km · ${x.runs}회 · 훈련한 주 ${x.weeks}주 · 20km+ ${x.longCount}회(최장 ${x.longest.toFixed(1)}km) · 강훈련 ${x.quality}회` +
    `${x.easyShare !== null ? ` · 이지 강도 비율 ${x.easyShare}%` : ''}${x.crossCount ? ` · 크로스 ${x.crossCount}회(${x.crossMin}분)` : ''}` +
    `${x.races.length ? ` · 레이스 ${x.races.join(', ')}` : ''}`).join('\n');

  // 평가 월에 갱신된 PR
  const prChanges = [['pr_full', '풀'], ['pr_half', '하프'], ['pr_10k', '10K'], ['pr_5k', '5K']]
    .filter(([k]) => goal?.[`${k}_updated_at`] && ymd(toKst(goal[`${k}_updated_at`])).slice(0, 7) === evalKey)
    .map(([k, l]) => `${l} ${goal[k]}`);

  const weekPlan = monthlyWeekPlan(basics, goal, ymd(planDate));
  const monthTotal = weekPlan.reduce((s, w) => s + parseInt(w.split(': ')[1], 10), 0);

  // 대회까지 월 순서
  let monthRoadmap = '';
  if (goal?.race_date && basics.daysLeft > 0) {
    const raceD = new Date(goal.race_date + 'T00:00:00Z');
    const list = [];
    for (let d = new Date(planDate); d <= raceD; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const isRace = d.getUTCMonth() === raceD.getUTCMonth() && d.getUTCFullYear() === raceD.getUTCFullYear();
      list.push(`${d.getUTCMonth() + 1}월${isRace ? '(대회)' : ''}`);
    }
    monthRoadmap = list.join(' → ');
  }

  const prompt = `마라톤 전문 코치로서 월간 리포트를 작성하세요. 선수는 텔레그램으로 읽습니다.

📅 작성일: ${ctx.todayLabel} | 평가: ${evalLabel} | 계획: ${planLabel}
선수 목표: ${goal?.race_name || '마라톤'} ${goal?.target_time || ''} | D-${basics.daysLeft ?? '?'} | ${basics.phase}
PR: 풀 ${goal?.pr_full || '-'} / 하프 ${goal?.pr_half || '-'} / 10K ${goal?.pr_10k || '-'} / 5K ${goal?.pr_5k || '-'}

${coachBasicsBlock(basics)}${athleteNoteBlock(basics.athleteNote)}
[최근 4개월 추세] (마지막 줄이 평가 월)
${trendText}
${effTrend !== null ? `이지런 심박당 속도 효율: ${Number(months[0].slice(5))}월 대비 ${evalLabel.split(' ')[0]} ${effTrend >= 0 ? '+' : ''}${effTrend.toFixed(1)}% (±3% 이내는 유지 수준. 기온 영향이 커서 여름→가을은 자연히 오르고 가을→겨울도 변동 — 계절 차이를 감안해 해석할 것)` : '이지런 효율: 심박 데이터 부족'}
${prChanges.length ? `평가 월 PR 갱신: ${prChanges.join(', ')}` : '평가 월 PR 갱신 없음'}

[${planLabel} 주차별 권장 거리 — 이 숫자를 그대로 사용]
${weekPlan.map(w => `- ${w}`).join('\n')}
(월 합계 약 ${monthTotal}km)
${monthRoadmap ? `[대회까지 월 순서] ${monthRoadmap}` : ''}

아래 순서로 3500자 이내 작성 (표 금지, 목록 사용):

## ${evalLabel} 종합 평가
**훈련량·일관성** — 4개월 추세의 숫자를 인용해 평가 (2-3문장)
**훈련 질** — 강도 분포(이지 비율), 롱런 진척, 강훈련 빈도 (2-3문장)
**체력 변화** — 이지런 효율 추세, PR·레이스로 본 변화. 숫자가 없으면 없다고 말할 것 (2문장)
**목표 달성 가능성** — 현재 마라톤 페이스와 목표 페이스의 차이(초/km)를 근거로 솔직하게. 남은 기간에 현실적으로 줄일 수 있는 폭과 함께 가능성 %를 제시 (2-3문장)

## ${planLabel} 로드맵
**월간 목표** — 거리 ${monthTotal}km 내외, 핵심 목표 3개 (약점 프로파일과 연결)
**주차별 계획** — 위 권장 거리 주차마다: 핵심 훈련 2개(날짜·페이스·심박 포함), 회복 주는 회복 위주
${monthRoadmap ? '**대회까지 월별 테마** — 위 월 순서대로 한 줄씩' : ''}

**코치 한마디** — 1-2문장`;

  return callClaude(prompt, 3500, 'medium');
}

// ══════════════════════════════════════
// 트라이애슬론 일일 분석
// ══════════════════════════════════════
async function analyzeTriathlonDaily(activities, goal, recentActivities, athleteNote, basics) {
  const targetPace = goalPaceStr(goal);
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

  const prompt = `트라이애슬론 전문 코치로서 오늘 훈련을 분석하세요. 선수는 텔레그램으로 읽습니다.
${basics ? coachBasicsBlock(basics) : ''}${athleteNoteBlock(athleteNote)}
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
  const targetPace = goalPaceStr(goal);
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
    const dow = DOW_KO[kstDow(a.start_date)];
    return `- [${dow}] [${st}] ${(a.distance/1000).toFixed(1)}km / ${Math.floor(a.moving_time/60)}분`;
  }).join('\n') || '이번 주 기록 없음';

  const lastWeekSummary = lastWeekActs.map(a => {
    const st = getSportType(a);
    return `- [${st}] ${(a.distance/1000).toFixed(1)}km / ${Math.floor(a.moving_time/60)}분`;
  }).join('\n') || '기록 없음';

  // A1: 이전 코칭 노트
  const prevCoachingNote = await fetchCoachingNote(userId, 'weekly_tri');
  const athleteNote = await fetchAthleteNote(userId);

  // 공통 기반 (현재 실력 기준 러닝 페이스·심박·코칭 원칙)
  const basics = await buildCoachBasics(userId, goal);

  // S2: 계획 대비 실행
  const planComparison = await fetchWeeklyPlanComparison(userId, ctx.weekStart, thisWeekActs, basics.refPaceStr, ctx, basics.zones, basics);

  // S5: 주간 KPI
  const totalThisKm = parseFloat(thisRunKm) + parseFloat(thisBikeKm) + parseFloat(thisSwimKm);
  const triWeeklyTarget = 80; // 트라이애슬론 주간 목표
  const kpiSummary = `러닝 ${thisRunKm}km | 자전거 ${thisBikeKm}km | 수영 ${thisSwimKm}km${planComparison ? ` | 계획이행 ${planComparison.rate}%` : ''}`;

  const remainingStr = ctx.remainingDaysCount > 0
    ? `${ctx.remainingDays.join(', ')}${ctx.hasSundayLeft ? ' (일요일: 일산호수 LSD 고정, 시간 기준)' : ''}`
    : '없음 (오늘이 일요일)';

  const planDates = ctx.todayDow === 0 ? ctx.nextWeekDates : ctx.remainingDayDates.concat(ctx.nextWeekDates);
  const prompt = `트라이애슬론 전문 코치로서 주간 리포트를 작성하세요. 선수는 텔레그램으로 읽습니다.
${coachBasicsBlock(basics)}${athleteNoteBlock(athleteNote)}
📅 오늘: ${ctx.todayLabel} | 이번 주 ${ctx.weekDayNum}일차 | ${ctx.weekRange}
📊 이번 주 KPI: ${kpiSummary}
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
남은 날 각각 한 줄씩 날짜·요일과 함께 (예: "- 11/28(금) 수영 2km 지속주").

**다음 주 훈련 계획 (${ctx.nextWeekLabels[0]} ~ ${ctx.nextWeekLabels[6]})**
${ctx.nextWeekLabels.join(', ')} 각각 한 줄: 종목·거리/시간·강도(러닝은 페이스·심박). 토요일은 벽돌훈련(자전거+러닝) 권장, 일요일은 일산호수 LSD(시간 기준).

**핵심 훈련 상세**
1. [벽돌훈련 - 자전거 거리/강도 → 러닝 거리/페이스]
2. [장거리 수영 or 자전거]
3. [마라톤 페이스런]

**이번 주 핵심 포인트**
(트라이애슬론과 마라톤 병행 관련 2-3가지)
${planBlockInstruction(planDates)}`;

  const raw = await callClaude(prompt, 2300, 'medium');
  const { clean, items } = extractPlan(raw);
  try { await storePlanItems(userId, items); } catch (e) { console.error('plan store error:', e.message); }

  // A1: 코칭 노트 저장
  await saveCoachingNote(userId, 'weekly_tri', ctx.weekStart, clean);
  return clean;
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
async function fetchWeeklyPlanComparison(userId, weekStart, thisWeekActs, refPace, ctx, zones, basics = null) {
  try {
    const plans = await sbGet('weekly_plans', `user_id=eq.${userId}&week_start=eq.${weekStart}`);
    if (!plans || plans.length === 0) return null;
    const plan = plans[0];
    const dayLabel = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };
    const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    // 이번 주에서 이미 지난 요일 — 오늘은 이미 훈련했을 때만 포함 (하루가 끝나기 전엔 미실시로 보지 않음)
    const ranToday = thisWeekActs.some(a => ymd(toKst(a.start_date)) === ctx.today);
    const passed = order.slice(0, ctx.weekDayNum - (ranToday ? 0 : 1));

    const doneByDay = {};
    thisWeekActs.forEach(a => {
      const key = DOW_KEY[kstDow(a.start_date)];
      const st = getSportType(a);
      const wt = isCrossTraining(st) ? st : basics ? labelOf(a, basics) : classifyWorkout(a, refPace, st, zones, null);
      (doneByDay[key] = doneByDay[key] || []).push(`${wt} ${(a.distance / 1000).toFixed(1)}km@${calcPace(a.moving_time, a.distance)}`);
    });

    const comparisons = [];
    for (const day of passed) {
      const planned = plan[day] || '';
      if (!planned) continue;
      const done = doneByDay[day] || [];
      const isRest = planned === '휴식';
      const ok = isRest ? done.length === 0 : done.length > 0;
      const mark = isRest ? (ok ? '✅ 휴식' : `➕ 휴식 대신 ${done.join(', ')}`) : (ok ? `✅ ${done.join(', ')}` : '❌ 미실시');
      comparisons.push(`- ${dayLabel[day]}: 계획[${planned}] → ${mark}`);
    }
    if (comparisons.length === 0) return null;
    const completedCount = comparisons.filter(l => l.includes('✅')).length;
    const totalCount = comparisons.length;
    return { text: comparisons.join('\n'), completedCount, totalCount, rate: Math.round(completedCount / totalCount * 100) };
  } catch (e) {
    console.error('fetchWeeklyPlanComparison error:', e.message);
    return null;
  }
}

// ══════════════════════════════════════
// S5: 훈련 완료율 KPI 계산
// LSD 완료율, 주간 거리 달성률, 강도훈련 횟수
// ══════════════════════════════════════
function calcWeeklyKPI(thisWeekActs, weeklyTarget, refPace, zones, basics = null) {
  const runActs = thisWeekActs.filter(a => ['러닝', '트레일런'].includes(getSportType(a)));
  const totalKm = runActs.reduce((s, a) => s + a.distance, 0) / 1000;
  const distRate = Math.round(totalKm / weeklyTarget * 100);
  const longCount = runActs.filter(a => a.distance >= 15000).length;
  const intensityCount = runActs.filter(a => QUALITY_TYPES.includes(basics ? labelOf(a, basics) : classifyWorkout(a, refPace, getSportType(a), zones, null))).length;
  const crossCount = thisWeekActs.length - runActs.length;
  return {
    totalKm: totalKm.toFixed(1), weeklyTarget, distRate, longCount, intensityCount,
    summary: `러닝 ${totalKm.toFixed(1)}km/${weeklyTarget}km(${distRate}%) | 15km+ ${longCount}회 | 강훈련 ${intensityCount}회${crossCount ? ` | 크로스 ${crossCount}회` : ''}`
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
// A2: 선수 약점 프로파일 — 규칙 기반 판정 (주간 리포트 때 갱신)
// 결과는 athlete_profiles에 저장되고, 모든 AI 코칭 프롬프트에 주입됨
// ══════════════════════════════════════
const RUN_SPORTS = `sport_type=in.(${encodeURIComponent('러닝')},${encodeURIComponent('트레일런')})`;

function parseLaps(laps) {
  if (!laps) return [];
  try {
    const arr = typeof laps === 'string' ? JSON.parse(laps) : laps;
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function median(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function uniqueByStravaId(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter(a => {
    if (seen.has(a.strava_id)) return false;
    seen.add(a.strava_id);
    return true;
  });
}

// 랩을 전반(앞 절반)/후반으로 나눠 페이스·심박 비교 (500m 미만 자투리 랩 제외)
function splitLapHalves(laps, lateFraction = 0.5) {
  const valid = laps.filter(l => l.distance >= 500 && l.moving_time > 0);
  if (valid.length < 10) return null;
  const n = valid.length;
  const first = valid.slice(0, Math.floor(n / 2));
  const late = valid.slice(Math.floor(n * (1 - lateFraction)));
  const agg = (ls) => {
    const d = ls.reduce((s, l) => s + l.distance, 0);
    const t = ls.reduce((s, l) => s + l.moving_time, 0);
    const hrLaps = ls.filter(l => l.average_heartrate > 0);
    const hr = hrLaps.length === ls.length
      ? hrLaps.reduce((s, l) => s + l.average_heartrate * l.moving_time, 0) / t
      : null;
    return { pace: t / (d / 1000), speed: d / t, hr };
  };
  return { first: agg(first), late: agg(late) };
}

// 최대심박 자동 추정: 최근 1년 러닝 최고 심박 중 센서가 튄 값(다음 값보다 8bpm 넘게 높음)을 제외한 최고값
function estimateHrMax(values) {
  const v = values.filter(x => x > 120 && x < 230).map(Math.round).sort((a, b) => b - a);
  if (v.length < 10) return null;
  const removed = [];
  while (v.length >= 2 && v[0] - v[1] > 8 && removed.length < 2) removed.push(v.shift());
  return {
    value: v[0],
    basis: `최근 1년 러닝 ${values.length}회 중 최고 심박${removed.length ? ` (튀는 값 ${removed.join(', ')} 제외)` : ''}`
  };
}

// 훈련 심박 구간 (Daniels 기준). 같은 강도가 두 방식에서 대응되도록 방식별 %를 다르게 적용
// - 안정시 심박 있음: 여유심박(카르보넨) %  /  없음: 최대심박 %
const HR_ZONE_PCT = {
  max: { easy: [0.65, 0.79], marathon: [0.80, 0.87], threshold: [0.88, 0.92], interval: [0.93, 1.00] },
  hrr: { easy: [0.59, 0.74], marathon: [0.75, 0.82], threshold: [0.83, 0.88], interval: [0.89, 1.00] },
};
const HR_ZONE_LABEL = { easy: '이지', marathon: '마라톤(페이스주)', threshold: '역치(템포)', interval: '인터벌' };
const WATCH_ZONE_LABEL = { easy: '유산소 지구력', marathon: '유산소 파워', threshold: '젖산역치', interval: '무산소' };

// 시계 구간 시작값 {z1..z5} 검증: 5개 모두 정수, 오름차순, 80~230
function validWatchZones(z) {
  if (!z || typeof z !== 'object') return null;
  const v = ['z1', 'z2', 'z3', 'z4', 'z5'].map(k => Number(z[k]));
  if (v.some(x => !Number.isInteger(x) || x < 80 || x > 230)) return null;
  for (let i = 1; i < v.length; i++) if (v[i] < v[i - 1]) return null;
  return { z1: v[0], z2: v[1], z3: v[2], z4: v[3], z5: v[4] };
}

// 우선순위: 시계 구간 → 여유심박(최대+안정시) → 최대심박 %
function calcHrZones(hrMax, hrRest, watch) {
  if (watch) {
    return {
      method: 'watch', labels: WATCH_ZONE_LABEL, watch,
      easy: [watch.z1, watch.z2 - 1], marathon: [watch.z2, watch.z3 - 1],
      threshold: [watch.z3, watch.z4 - 1], interval: [watch.z4, Math.max(hrMax || 0, watch.z5)]
    };
  }
  const useRest = hrRest && hrRest < hrMax;
  const pct = useRest ? HR_ZONE_PCT.hrr : HR_ZONE_PCT.max;
  const at = (p) => Math.round(useRest ? hrRest + p * (hrMax - hrRest) : p * hrMax);
  const zones = { method: useRest ? 'karvonen' : 'max', labels: HR_ZONE_LABEL };
  for (const k of Object.keys(pct)) zones[k] = [at(pct[k][0]), at(pct[k][1])];
  return zones;
}

function hrZonesText(z) {
  if (z.method === 'watch') {
    const w = z.watch;
    return `유산소 지구력(이지런) ${w.z1}-${w.z2 - 1} / 유산소 파워(페이스주) ${w.z2}-${w.z3 - 1} / ` +
      `젖산역치(템포런) ${w.z3}-${w.z4 - 1} / 무산소 지구력(인터벌) ${w.z4}-${w.z5} / 무산소 파워 ${w.z5}+`;
  }
  return Object.keys(HR_ZONE_LABEL).map(k => `${HR_ZONE_LABEL[k]} ${z[k][0]}-${z[k][1]}`).join(' / ');
}

async function buildAthleteProfile(userId, goal, userProfile) {
  const now = Date.now();
  const iso = (days) => new Date(now - days * 86400000).toISOString();
  const weeksAgo = (w) => now - w * 7 * 86400000;
  const cols = 'strava_id,distance,moving_time,start_date,avg_heartrate,max_heartrate,avg_cadence,workout_type,sport_type';

  // 최근 6개월 러닝 (랩 제외 — 가벼운 조회)
  const runs = uniqueByStravaId(await sbGet('activities',
    `user_id=eq.${userId}&${RUN_SPORTS}&start_date=gte.${iso(182)}&select=${cols}&order=start_date.desc&limit=600`));
  // 15km 이상은 랩 포함 (유산소 디커플링·레이스 후반 분석용), 레이스 판단 위해 12개월
  const longRuns = uniqueByStravaId(await sbGet('activities',
    `user_id=eq.${userId}&${RUN_SPORTS}&distance=gte.15000&start_date=gte.${iso(365)}&select=${cols},laps&order=start_date.desc&limit=80`));
  const conditions = await sbGet('conditions',
    `user_id=eq.${userId}&date=gte.${iso(182).slice(0, 10)}&select=date,injury_part,injury_level&order=date.desc`);

  // 처방·분류 기준: 현재 마라톤 페이스 (공통 기반과 같은 계산)
  const mpInfo = estimateCurrentMP(goal, runs.concat(longRuns));
  const targetPace = secToPaceStr(mpInfo.sec);
  const metrics = { runs6m: runs.length, currentMP: targetPace, currentMPSource: mpInfo.source };
  const weaknesses = [];
  const strengths = [];

  // 심박 기준 — 최대심박: 직접 입력 우선, 없으면 자동 추정 / 안정시 심박: 직접 입력
  const hrRows = uniqueByStravaId(await sbGet('activities',
    `user_id=eq.${userId}&${RUN_SPORTS}&max_heartrate=gt.0&start_date=gte.${iso(365)}&select=strava_id,max_heartrate&limit=1000`));
  const autoMax = estimateHrMax(hrRows.map(a => a.max_heartrate));
  const hrMax = userProfile?.hr_max || autoMax?.value || null;
  const hrRest = userProfile?.hr_rest || null;
  const watchZones = validWatchZones(userProfile?.hr_watch_zones);
  const zones = watchZones ? calcHrZones(hrMax, hrRest, watchZones)
    : hrMax ? calcHrZones(hrMax, hrRest) : null;
  metrics.hrMax = hrMax;
  metrics.hrMaxSource = userProfile?.hr_max ? 'manual' : (autoMax ? 'auto' : null);
  metrics.hrMaxAuto = autoMax?.value ?? null;
  metrics.hrMaxAutoBasis = autoMax?.basis ?? null;
  metrics.hrRest = hrRest;
  metrics.hrZones = zones;

  // ① 이지런 강도 — 이지런 평균 심박이 이지 구간 상한을 넘은 비율
  if (zones) {
    const typeOf = (a) => RUN_LABELS.includes(a.workout_type) ? a.workout_type : classifyRunIntensity(a, mpInfo.sec, zones, null);
    const easy = runs.filter(a => a.avg_heartrate > 0 && typeOf(a) === '이지런');
    if (easy.length >= 8) {
      const limit = zones.easy[1];
      const pct = Math.round(easy.filter(a => a.avg_heartrate > limit).length / easy.length * 100);
      metrics.easyTooHardPct = pct;
      if (pct >= 20) {
        weaknesses.push({
          key: 'easy_intensity', label: '이지런 강도 과다', severity: pct >= 40 ? 'high' : 'medium',
          evidence: `이지런 ${easy.length}회 중 ${pct}%가 ${zones.labels.easy} 구간 상한(${limit}bpm) 초과`,
          advice: `이지런은 ${zones.labels.easy} 구간(${zones.easy[0]}-${zones.easy[1]}bpm), 대화 가능한 강도로. 쉬는 날을 확실히 쉬어야 강한 날이 강해집니다.`
        });
      } else if (pct <= 10) {
        strengths.push({ key: 'easy_intensity', label: '이지런 강도 조절', evidence: `이지런의 ${100 - pct}%를 ${zones.labels.easy} 구간 안에서 소화` });
      }
    }
  }

  // ② 유산소 기반 — 롱런 전반 대비 후반의 속도/심박 효율 저하(디커플링)
  const decouples = longRuns
    .filter(a => a.distance < 38000 && new Date(a.start_date).getTime() > weeksAgo(26))
    .map(a => splitLapHalves(parseLaps(a.laps)))
    .filter(h => h && h.first.hr && h.late.hr)
    .slice(0, 10)
    .map(h => ((h.first.speed / h.first.hr) / (h.late.speed / h.late.hr) - 1) * 100);
  if (decouples.length >= 4) {
    const avg = Math.round(decouples.reduce((s, v) => s + v, 0) / decouples.length * 10) / 10;
    metrics.aerobicDecouplingPct = avg;
    metrics.aerobicSamples = decouples.length;
    if (avg > 5) {
      weaknesses.push({
        key: 'aerobic_base', label: '유산소 기반 부족', severity: avg > 8 ? 'high' : 'medium',
        evidence: `롱런 ${decouples.length}회 평균, 후반에 같은 속도 대비 심박이 ${avg}% 더 오름`,
        advice: '롱런은 페이스보다 심박 유지에 집중하세요. 후반 심박이 오르면 속도를 낮추는 게 맞습니다. 낮은 강도의 볼륨을 늘리는 것이 핵심.'
      });
    } else if (avg < 3) {
      strengths.push({ key: 'aerobic_base', label: '탄탄한 유산소 기반', evidence: `롱런 후반 심박 상승 ${avg}%로 안정적` });
    }
  }

  // ③ 스피드/품질 훈련 — 최근 8주 인터벌·템포·페이스주 횟수
  const recent8w = runs.filter(a => new Date(a.start_date).getTime() > weeksAgo(8));
  const quality = recent8w.filter(a => QUALITY_TYPES.includes(RUN_LABELS.includes(a.workout_type) ? a.workout_type : classifyRunIntensity(a, mpInfo.sec, zones, null))).length;
  metrics.qualitySessions8w = quality;
  if (recent8w.length >= 8) {
    if (quality < 2) {
      weaknesses.push({
        key: 'speed_work', label: '스피드 훈련 부족', severity: quality === 0 ? 'high' : 'medium',
        evidence: `최근 8주 인터벌·언덕·템포·페이스주 ${quality}회`,
        advice: `주 1회 템포런(${calcPaceOffset(targetPace, 15)}/km${zones ? `, 심박 ${zones.threshold[0]}-${zones.threshold[1]}` : ''}) 또는 인터벌(${calcPaceOffset(targetPace, 30)}/km${zones ? `, 심박 ${zones.interval[0]}+` : ''})을 넣으세요. 나머지는 확실히 천천히.`
      });
    } else if (quality >= 6) {
      strengths.push({ key: 'speed_work', label: '꾸준한 품질 훈련', evidence: `최근 8주 품질 훈련 ${quality}회` });
    }
  }

  // ④ 훈련 일관성 — 최근 12주 주간 거리
  const weekKm = Array(12).fill(0);
  runs.forEach(a => {
    const w = Math.floor((now - new Date(a.start_date).getTime()) / (7 * 86400000));
    if (w >= 0 && w < 12) weekKm[w] += a.distance / 1000;
  });
  const activeWeeks = weekKm.filter(k => k > 0).length;
  const avgKm = weekKm.reduce((s, v) => s + v, 0) / 12;
  const cv = avgKm > 0
    ? Math.round(Math.sqrt(weekKm.reduce((s, v) => s + (v - avgKm) ** 2, 0) / 12) / avgKm * 100)
    : null;
  metrics.activeWeeks12 = activeWeeks;
  metrics.weeklyKmAvg12 = Math.round(avgKm * 10) / 10;
  metrics.weeklyCvPct = cv;

  // 개인화 주간 목표 (공통 기반과 같은 계산) — 대시보드 표시용으로 저장
  {
    const wt = weeklyTargetFromRuns(uniqueByStravaId(runs.concat(longRuns)), goal, now);
    metrics.weeklyTargetKm = wt.km;
    metrics.weeklyTargetBasis = wt.basis;
  }
  const isTri = goal?.goal_type === 'both' || goal?.goal_type === 'triathlon';
  if (runs.length >= 8) {
    if (activeWeeks < 10 || (cv !== null && cv > 55)) {
      weaknesses.push({
        key: 'consistency', label: '훈련 일관성 부족', severity: activeWeeks < 8 ? 'high' : 'medium',
        evidence: `최근 12주 중 러닝한 주 ${activeWeeks}주, 주간 거리 변동 ${cv}%`,
        advice: isTri
          ? '종목 배분과 별개로 러닝은 매주 최소 2~3회 유지하세요. 몰아서 뛰기보다 꾸준함이 우선.'
          : '몰아서 많이 뛰는 주와 쉬는 주의 차이를 줄이세요. 매주 최소 3회, 주간 거리 증가는 10% 이내로.'
      });
    } else if (activeWeeks === 12 && cv !== null && cv <= 30) {
      strengths.push({ key: 'consistency', label: '꾸준한 훈련', evidence: `12주 연속 훈련, 주간 거리 변동 ${cv}%` });
    }
  }

  // ⑤ 장거리 — 최근 6주 20km 이상 횟수 (기초체력기에는 판정 생략)
  const phase = getTrainingPhase(goal?.race_date);
  const raceAhead = goal?.race_date && new Date(goal.race_date).getTime() > now;
  const long6w = longRuns.filter(a => a.distance >= 20000 && a.distance < 38000 &&
    new Date(a.start_date).getTime() > weeksAgo(6)).length;
  metrics.longRuns20k6w = long6w;
  if (runs.length >= 8 && !isTri && phase !== '기초체력기' && raceAhead) {
    if (long6w === 0) {
      weaknesses.push({
        key: 'long_run', label: '장거리 훈련 부족', severity: 'high',
        evidence: `${phase}인데 최근 6주 20km 이상 러닝 0회`,
        advice: `일요일 LSD 시간을 점진적으로 늘려 20km 이상을 확보하세요 (현재 LSD 페이스 ${secToPaceStr(mpInfo.sec + 60)}/km 기준 약 ${fmtMin(Math.round(20 * (mpInfo.sec + 60) / 60))}).`
      });
    } else if (long6w >= 4) {
      strengths.push({ key: 'long_run', label: '충분한 장거리 훈련', evidence: `최근 6주 20km+ ${long6w}회` });
    }
  }

  // ⑥ 케이던스 — 로드 러닝 중앙값 (저장값은 양발 기준 spm)
  const cads = runs.filter(a => a.sport_type === '러닝' && a.avg_cadence > 100).map(a => a.avg_cadence);
  if (cads.length >= 10) {
    const cad = Math.round(median(cads));
    metrics.cadenceMedian = cad;
    if (cad < 170) {
      weaknesses.push({
        key: 'cadence', label: '낮은 케이던스', severity: cad < 162 ? 'high' : 'medium',
        evidence: `러닝 케이던스 중앙값 ${cad}spm`,
        advice: '보폭을 조금 줄이고 발걸음 수를 늘리는 방향으로. 급격히 바꾸면 부상 위험이 있으니 한 번에 5% 이내로 천천히 올리세요.'
      });
    } else if (cad >= 180) {
      strengths.push({ key: 'cadence', label: '효율적인 케이던스', evidence: `케이던스 중앙값 ${cad}spm` });
    }
  }

  // ⑦ 레이스 후반 저하 — 최근 1년 풀코스 거리(38km+) 러닝의 마지막 1/4 vs 전반
  //    (DB에 레이스 표시가 없어 거리로 판별 — 38km 이상 훈련도 포함될 수 있음)
  const raceFades = longRuns.filter(a => a.distance >= 38000)
    .map(a => ({ date: kstLabel(a.start_date), h: splitLapHalves(parseLaps(a.laps), 0.25) }))
    .filter(r => r.h)
    .slice(0, 3)
    .map(r => ({ date: r.date, fadePct: Math.round((r.h.late.pace / r.h.first.pace - 1) * 1000) / 10 }));
  if (raceFades.length > 0) {
    const latest = raceFades[0];
    metrics.raceFade = raceFades;
    if (latest.fadePct > 3) {
      weaknesses.push({
        key: 'race_fade', label: '레이스 후반 페이스 저하', severity: latest.fadePct > 8 ? 'high' : 'medium',
        evidence: `최근 풀코스(${latest.date}) 마지막 1/4 구간이 전반보다 ${latest.fadePct}% 느려짐`,
        advice: '레이스 초반을 목표 페이스보다 5~10초 느리게 시작하고, 30km 이후를 대비한 보급과 롱런 후반 페이스 연습을 하세요.'
      });
    } else if (latest.fadePct <= 1) {
      strengths.push({ key: 'race_fade', label: '레이스 페이스 운영', evidence: `최근 풀코스 후반 변화 ${latest.fadePct}% (이븐/네거티브)` });
    }
  }

  // ⑧ 반복 부상 부위 — 최근 6개월 컨디션 기록에서 같은 부위 2회 이상
  const partCount = {};
  (Array.isArray(conditions) ? conditions : []).forEach(c => {
    const p = (c.injury_part || '').trim();
    if (!p || p === '없음') return;
    if (!partCount[p]) partCount[p] = { part: p, count: 0, lastDate: c.date, lastLevel: c.injury_level };
    partCount[p].count++;
  });
  const cautions = Object.values(partCount).filter(c => c.count >= 2).sort((a, b) => b.count - a.count);

  // ⑨ 목표 대비 현재 실력 격차 — 현재 마라톤 페이스(최근 대회·PR 기준) vs 목표 기록 페이스
  const goalSec = goalPaceSec(goal);
  if (goalSec && mpInfo?.sec && !isTri && raceAhead) {
    const gap = Math.round(mpInfo.sec - goalSec);
    metrics.goalGapSec = gap;
    const hms = (sec) => { sec = Math.round(sec); return `${Math.floor(sec / 3600)}:${String(Math.floor(sec % 3600 / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; };
    const predicted = hms(mpInfo.sec * 42.195);
    const weeksLeft = Math.floor((new Date(goal.race_date) - Date.now()) / (7 * 86400000));
    if (gap >= 15) {
      const until = goal.race_date ? Math.ceil((new Date(goal.race_date) - Date.now()) / 86400000) : 60;
      const checks = (await fetchClubRuns(Date.now(), Math.max(0, until - 21))).filter(c => /race|대회/i.test(c.type) && c.km >= 10);
      const cp = checks[0];
      weaknesses.push({
        key: 'goal_gap', label: '목표 대비 현재 실력 격차', severity: gap >= 30 ? 'high' : 'medium',
        evidence: `현재 실력 기준 풀코스 예상 ${predicted}(${mpInfo.source}) vs 목표 ${goal.target_time} — ${gap}초/km 차이, 대회까지 ${weeksLeft}주`,
        advice: `훈련은 목표 페이스가 아니라 현재 실력 기준으로 하고, ${cp ? `${cp.label} ${cp.type} ${cp.km}km` : '중간 점검 대회(하프 등)'}로 실제 향상을 확인한 뒤 목표 기록을 다시 판단하세요.`
      });
    } else if (gap <= 5) {
      strengths.push({ key: 'goal_gap', label: '목표에 근접한 실력', evidence: `현재 예상 ${predicted}, 목표 ${goal.target_time}과 ${gap <= 0 ? '이미 같거나 빠름' : `${gap}초/km 차이`}` });
    }
  }

  // 심각도 순 정렬, 상위 3개를 핵심 약점으로
  const sevRank = { high: 0, medium: 1 };
  weaknesses.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

  // 코칭 프롬프트용 요약
  const lines = [];
  if (zones) {
    const src = metrics.hrMaxSource === 'manual' ? '직접 입력' : '데이터 추정';
    const basisText = zones.method === 'watch'
      ? '선수 시계의 젖산역치 기반 구간'
      : `최대 ${hrMax}bpm(${src})${hrRest ? `, 안정시 ${hrRest}bpm(여유심박 방식)` : ''}`;
    lines.push(`심박 기준: ${basisText} → ${hrZonesText(zones)}. 심박 평가는 이 구간 기준으로 할 것.`);
  }
  if (weaknesses.length) {
    lines.push('약점(우선순위순):');
    weaknesses.slice(0, 3).forEach((w, i) => lines.push(`${i + 1}. ${w.label} — ${w.evidence}. 처방: ${w.advice}`));
  }
  if (strengths.length) lines.push(`강점: ${strengths.map(s => `${s.label}(${s.evidence})`).join(', ')}`);
  if (cautions.length) lines.push(`주의 부위: ${cautions.map(c => `${c.part} ${c.count}회(최근 ${c.lastDate})`).join(', ')} — 이 부위에 부담 주는 처방은 피하거나 강도를 낮출 것`);
  const summary = lines.length ? lines.join('\n') : '';

  const profile = {
    user_id: userId, metrics, weaknesses, strengths, cautions, summary,
    updated_at: new Date().toISOString()
  };
  await sbUpsert('athlete_profiles', profile, 'user_id');
  return profile;
}

async function fetchAthleteNote(userId) {
  try {
    const rows = await sbGet('athlete_profiles', `user_id=eq.${userId}&select=summary`);
    return rows?.[0]?.summary || '';
  } catch (e) { return ''; }
}

function athleteNoteBlock(note) {
  return note
    ? `\n🧬 선수 약점 프로파일 (데이터 기반 — 평가·처방에 반드시 반영하고, 해당되는 약점이 오늘/이번 주 훈련에 드러났다면 구체적으로 짚어줄 것):\n${note}\n`
    : '';
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
      const msg = `🎉 <b>개인 최고 기록(PB) 갱신!</b>\n─────────\n${improved.join('\n')}\n\n📅 ${activity.start_date_local?.slice(0, 10) || ''} · ${escapeTg(activity.name)}`;
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

    // 약점 프로파일만 갱신 (웹앱 대시보드에서 호출, 텔레그램 발송 없음, Strava 호출 없음)
    if (type === 'profile') {
      const athleteProfile = await buildAthleteProfile(userId, goal, profile);
      return res.json({ success: true, type: 'profile', profile: athleteProfile });
    }

    const accessToken = await refreshToken(profile, userId);

    // 주간 분석 (목표 타입에 따라 분기)
    if (type === 'weekly') {
      // 주간 리포트 전에 약점 프로파일 갱신 → 이번 리포트부터 최신 약점 반영
      try { await buildAthleteProfile(userId, goal, profile); }
      catch (e) { console.error('Athlete profile error:', e.message); }
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
    const targetPace = goalPaceStr(goal);
    const isTri = goal?.goal_type === 'both' || goal?.goal_type === 'triathlon';

    // A1+S3: 일일 분석에 필요한 데이터 사전 로드
    const dailyCoachingNote = await fetchCoachingNote(userId, 'daily');
    const basics = await buildCoachBasics(userId, goal);  // 현재 실력 기준 페이스·심박·주간 목표·최근 기록 (DB)
    const dailyAthleteNote = basics.athleteNote;

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
          const weekStart = getWeekStart(activity.start_date);
          const adjustedPace = sportType === '트레일런'
            ? calcAdjustedPace(activity.moving_time, activity.distance, activity.total_elevation_gain)
            : null;
          const details = await fetchActivityDetails(activity.id, accessToken);
          // 랩까지 보고 분류 (인터벌·언덕 반복은 전체 평균으로는 이지런처럼 보임)
          const workoutType = classifyWorkout(activity, basics.refPaceStr, sportType, basics.zones, details.laps);
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
            analysis: null // 묶음 분석으로 대체
          });
        }

        // 당일 전체 활동 묶어서 분석
        const allDayActs = [...newDayActs]; // 새 활동들
        const analysis = await analyzeTriathlonDaily(allDayActs, goal, recentSaved.slice(0, 6), dailyAthleteNote, basics);

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
        const weekStart = getWeekStart(activity.start_date);
        const adjustedPace = sportType === '트레일런'
          ? calcAdjustedPace(activity.moving_time, activity.distance, activity.total_elevation_gain)
          : null;

        const details = await fetchActivityDetails(activity.id, accessToken);
        const workoutType = classifyWorkout(activity, basics.refPaceStr, sportType, basics.zones, details.laps);
        const phases = analyzePhases(details.laps);

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
          activity, goal, basics,
          workoutType, sportType, phases, details, weather, condition,
          dailyCoachingNote
        );

        // A1: 일일 코칭 노트 저장 (활동일 기준 주)
        const ctx = getDateContext(utcMs(activity.start_date));
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
        const title = `${sportIcon} <b>${escapeTg(activity.name)}</b> [${workoutType}]\n📏 ${km}km | ⚡ ${pace}/km${adjustedPace ? ` (환산 ${adjustedPace}/km)` : ''}${avgHR ? ` | ❤️ ${avgHR}bpm` : ''}`;
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
