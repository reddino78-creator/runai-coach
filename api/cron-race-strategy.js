const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Supabase 헬퍼 ──
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

// ── 페이스 변환 ──
function paceToSec(p) {
  if (!p || p === '-') return 0;
  const [m, s] = p.split(':').map(Number);
  return m * 60 + (s || 0);
}

function secToPace(s) {
  if (!s || s <= 0) return '--:--';
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

function secToTime(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── 훈련 단계 ──
function getTrainingPhase(raceDate) {
  if (!raceDate) return '기초체력기';
  const d = Math.ceil((new Date(raceDate) - new Date()) / 86400000);
  if (d > 140) return '기초체력기';
  if (d > 84)  return '훈련강화기';
  if (d > 42)  return '피크훈련기';
  if (d > 14)  return '테이퍼링기';
  return '레이스준비기';
}

// ══════════════════════════════════════
// ① 최근 3개월 훈련 데이터 분석
// ══════════════════════════════════════
function analyzeTrainingData(acts) {
  const now = Date.now();
  const threeMonthsAgo = now - 90 * 24 * 60 * 60 * 1000;
  const oneMonthAgo    = now - 30 * 24 * 60 * 60 * 1000;
  const twoWeeksAgo    = now - 14 * 24 * 60 * 60 * 1000;

  const runTypes = ['Run', 'VirtualRun', 'TrailRun', '러닝', '트레일런'];
  const runs = acts.filter(a => {
    const t = a.sport_type || a.type || '';
    return runTypes.some(r => t.includes(r)) && a.distance >= 3000;
  });

  const recent3m = runs.filter(a => new Date(a.start_date).getTime() > threeMonthsAgo);
  const recent1m = runs.filter(a => new Date(a.start_date).getTime() > oneMonthAgo);
  const recent2w = runs.filter(a => new Date(a.start_date).getTime() > twoWeeksAgo);

  // 주간 평균 거리 (3개월)
  const totalKm3m = recent3m.reduce((s, a) => s + a.distance, 0) / 1000;
  const weeklyAvgKm = totalKm3m / 13; // 13주

  // 최장 LSD 거리
  const lsdRuns = recent3m.filter(a => a.distance >= 15000);
  const longestLsdKm = lsdRuns.length > 0
    ? Math.max(...lsdRuns.map(a => a.distance / 1000))
    : 0;

  // LSD 완료 횟수 (20km 이상)
  const lsd20Count = recent3m.filter(a => a.distance >= 20000).length;

  // 강도훈련 비율 (빠른 페이스)
  const intensityCount = recent3m.filter(a => {
    const paceSec = a.moving_time / (a.distance / 1000);
    return paceSec < 340; // 5:40/km 이내
  }).length;
  const intensityRatio = recent3m.length > 0
    ? Math.round(intensityCount / recent3m.length * 100)
    : 0;

  // 체력 페이스 (가중 평균 — 최근 2주 가중 3배, 1개월 2배, 3개월 1배)
  // 레이스 기록(38km 이상 또는 workout_type=1)은 제외 — 훈련 페이스와 성격이 다름
  // 페이스 범위 필터: 3:30~8:00/km (210~480초)
  const isRace = (a) => a.distance >= 38000 || a.workout_type === 1;
  const validPaces = (runs) => runs
    .filter(a => !isRace(a))
    .map(a => a.moving_time / (a.distance / 1000))
    .filter(s => s >= 210 && s <= 480);

  // 레이스 기록 중 최근 3개월 내 풀마라톤(38km+) 최고 기록 별도 추출
  const recentRaces = recent3m.filter(a => isRace(a) && a.distance >= 38000);
  const bestRacePaceSec = recentRaces.length > 0
    ? Math.min(...recentRaces.map(a => a.moving_time / (a.distance / 1000)))
    : null;

  let totalW = 0, totalWS = 0;
  validPaces(recent2w).forEach(s => { totalWS += s * 3; totalW += 3; });
  validPaces(recent1m.filter(a => new Date(a.start_date).getTime() <= twoWeeksAgo))
    .forEach(s => { totalWS += s * 2; totalW += 2; });
  validPaces(recent3m.filter(a => new Date(a.start_date).getTime() <= oneMonthAgo))
    .forEach(s => { totalWS += s * 1; totalW += 1; });

  const fitnessPaceSec = totalW > 0 ? totalWS / totalW : 0;

  // 훈련 완성도 점수 (0~100)
  let completeness = 0;
  if (weeklyAvgKm >= 50) completeness += 30;
  else if (weeklyAvgKm >= 35) completeness += 20;
  else if (weeklyAvgKm >= 20) completeness += 10;

  if (longestLsdKm >= 30) completeness += 30;
  else if (longestLsdKm >= 25) completeness += 20;
  else if (longestLsdKm >= 20) completeness += 10;

  if (lsd20Count >= 4) completeness += 20;
  else if (lsd20Count >= 2) completeness += 10;

  if (intensityRatio >= 25) completeness += 20;
  else if (intensityRatio >= 15) completeness += 10;

  // 레이스 기록이 있으면 훈련 페이스와 비교해 더 빠른 쪽 반영
  // (실제 레이스 성과가 훈련보다 체력을 더 정확하게 보여줄 수 있음)
  const effectiveFitnessSec = bestRacePaceSec && bestRacePaceSec < fitnessPaceSec
    ? Math.round(bestRacePaceSec * 0.98 + fitnessPaceSec * 0.02) // 레이스 기록 98% 반영
    : Math.round(fitnessPaceSec);

  return {
    totalKm3m: totalKm3m.toFixed(0),
    weeklyAvgKm: weeklyAvgKm.toFixed(1),
    longestLsdKm: longestLsdKm.toFixed(1),
    lsd20Count,
    intensityRatio,
    fitnessPaceSec: effectiveFitnessSec,
    fitnessPace: secToPace(effectiveFitnessSec),
    bestRacePace: bestRacePaceSec ? secToPace(Math.round(bestRacePaceSec)) : null,
    completeness,
    runCount3m: recent3m.length,
    runCount1m: recent1m.length
  };
}

// ══════════════════════════════════════
// ② D-day까지 남은 훈련 향상치 예측
// ══════════════════════════════════════
function estimateImprovementByRaceDay(daysLeft, phase, completeness) {
  // 훈련 단계별 예상 페이스 향상 (초/km)
  // 훈련 완성도가 높을수록 더 많이 향상
  const baseImprovement = {
    '기초체력기': 25,
    '훈련강화기': 18,
    '피크훈련기': 10,
    '테이퍼링기': 3,
    '레이스준비기': 0
  };

  const base = baseImprovement[phase] || 0;
  // 완성도 보정: 완성도 60점 기준, ±50% 조정
  const factor = 0.5 + (completeness / 100);
  return Math.round(base * factor);
}

// ══════════════════════════════════════
// ③ AI로 현실적 목표 도출 + 전략 생성
// ══════════════════════════════════════
async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function deriveRealisticTargets(goal, training, daysLeft, phase, improvement) {
  const userTargetSec = paceToSec(goal.target_pace || '5:27');
  const fitnessSec = training.fitnessPaceSec;

  // 대회일 예상 페이스 = 현재 체력 페이스 - 향상치
  // Math.min: 체력 기반 예측과 목표의 95% 중 더 빠른(작은) 값은 허용하지 않음
  // → 단, 체력이 충분히 뒷받침되면 목표보다 빠른 전략도 가능
  const projectedPaceSec = fitnessSec - improvement;

  // 레이스 효율: 훈련 페이스 대비 레이스 페이스는 보통 3~8% 빠름
  // 완성도에 따라 조정
  const raceEfficiency = 0.93 + (training.completeness / 1000); // 0.93~0.97
  const racePaceSec90 = Math.round(projectedPaceSec * raceEfficiency);        // 90% 달성
  const racePaceSec80 = Math.round(projectedPaceSec * raceEfficiency * 0.975); // 80% (더 도전적)

  const totalDist = 42.195;
  const time90 = secToTime(racePaceSec90 * totalDist);
  const time80 = secToTime(racePaceSec80 * totalDist);
  const timeUser = secToTime(userTargetSec * totalDist);

  const prompt = `마라톤 전문 코치로서 선수의 현재 체력을 냉철하게 평가하고 현실적인 레이스 목표를 도출하세요.

[선수 현재 체력 데이터]
- 최근 3개월 총 훈련량: ${training.totalKm3m}km (주간 평균 ${training.weeklyAvgKm}km)
- 현재 체력 추정 페이스: ${training.fitnessPace}/km (최근 훈련 가중 평균)${training.bestRacePace ? ` | 최근 레이스 실제 페이스: ${training.bestRacePace}/km` : ''}
- 최장 LSD: ${training.longestLsdKm}km | 20km↑ LSD 횟수: ${training.lsd20Count}회
- 강도훈련 비율: ${training.intensityRatio}% | 훈련 완성도: ${training.completeness}/100점
- 최근 3개월 총 훈련 횟수: ${training.runCount3m}회

[대회 정보]
- 목표 대회: ${goal.race_name || '마라톤'} | D-${daysLeft}일 | 훈련 단계: ${phase}
- 선수 희망 목표: ${goal.target_time} (${goal.target_pace}/km)
- PR: 풀 ${goal.pr_full || '-'} / 하프 ${goal.pr_half || '-'} / 10K ${goal.pr_10k || '-'}

[시스템 계산 예측값]
- D-day까지 예상 향상: ${improvement}초/km
- 90% 달성 예측 페이스: ${secToPace(racePaceSec90)}/km → ${time90}
- 80% 달성 예측 페이스: ${secToPace(racePaceSec80)}/km → ${time80}
- 선수 희망 페이스: ${goal.target_pace}/km → ${timeUser}

위 데이터를 바탕으로 아래 JSON 형식으로만 응답하세요. 숫자는 반드시 현실적이어야 합니다:
{
  "assessment": "현재 훈련 상태 냉철한 평가 2문장",
  "userGoalFeasibility": "선수 희망 목표(${goal.target_time}) 달성 가능성 평가 1문장",
  "target90": {
    "targetTime": "${time90}",
    "paceSec": ${racePaceSec90},
    "probability": 90,
    "rationale": "이 목표가 90% 달성 가능한 근거 2문장",
    "keyPoint": "핵심 성공 조건 1문장"
  },
  "target80": {
    "targetTime": "${time80}",
    "paceSec": ${racePaceSec80},
    "probability": 80,
    "rationale": "이 목표가 80% 달성 가능한 근거 2문장",
    "keyPoint": "핵심 성공 조건 1문장"
  },
  "trainingAdvice": "D-${daysLeft}일 남은 훈련에서 가장 집중해야 할 것 2문장"
}`;

  try {
    const result = await callClaude(prompt);
    const clean = result.replace(/```json|```/g, '').trim();
    // JSON 추출
    const jsonMatch = clean.match(/\{[\s\S]+\}/);
    if (!jsonMatch) throw new Error('No JSON');
    const parsed = JSON.parse(jsonMatch[0]);

    // 페이스 범위 검증 (3:30~8:30/km = 210~510초)
    const validatePace = (p) => p > 210 && p < 510;
    if (!validatePace(parsed.target90?.paceSec) || !validatePace(parsed.target80?.paceSec)) {
      throw new Error('Invalid pace range');
    }
    return parsed;
  } catch (e) {
    console.error('AI target derivation failed, using calculated values:', e.message);
    // AI 실패 시 계산값 사용
    return {
      assessment: `현재 훈련 페이스 ${training.fitnessPace}/km 기준으로 평가한 현실적 목표입니다.`,
      userGoalFeasibility: `희망 목표 ${goal.target_time}은 현재 훈련 완성도(${training.completeness}점) 대비 ${
        paceToSec(goal.target_pace) < racePaceSec90 ? '도전적인' : '달성 가능한'} 목표입니다.`,
      target90: {
        targetTime: time90, paceSec: racePaceSec90, probability: 90,
        rationale: '현재 훈련량과 체력 페이스를 바탕으로 안정적으로 달성 가능한 목표입니다.',
        keyPoint: '이븐 페이스로 후반 30km 이후 흔들리지 않는 것이 핵심입니다.'
      },
      target80: {
        targetTime: time80, paceSec: racePaceSec80, probability: 80,
        rationale: '현재보다 한 단계 도전적인 목표로 최상의 컨디션이 필요합니다.',
        keyPoint: '네거티브 스플릿 전략으로 후반 가속이 관건입니다.'
      },
      trainingAdvice: `남은 ${daysLeft}일 동안 LSD와 페이스런을 중심으로 훈련 완성도를 높이세요.`
    };
  }
}

// ══════════════════════════════════════
// ④ 구간별 페이스 전략 (30km 벽 반영)
// ══════════════════════════════════════
function calc5KSplits(paceSec, probability) {
  const totalDist = 42.195;
  const segments = [
    { start: 0,    end: 5,      label: '워밍업 구간',      factor: probability === 90 ? 1.04 : 1.06 },
    { start: 5,    end: 10,     label: '안정화 구간',      factor: probability === 90 ? 1.01 : 1.02 },
    { start: 10,   end: 15,     label: '목표 페이스 유지', factor: 1.00 },
    { start: 15,   end: 20,     label: '목표 페이스 유지', factor: 1.00 },
    { start: 20,   end: 25,     label: '집중 구간',        factor: 1.00 },
    { start: 25,   end: 30,     label: '30km 벽 대비',     factor: probability === 90 ? 1.01 : 1.00 },
    { start: 30,   end: 35,     label: '30km 벽 극복',     factor: probability === 90 ? 0.99 : 0.98 },
    { start: 35,   end: 40,     label: '피니시 가속',      factor: probability === 90 ? 0.97 : 0.96 },
    { start: 40,   end: 42.195, label: '전력 질주',        factor: probability === 90 ? 0.95 : 0.94 }
  ];

  let cumTimeSec = 0;
  return segments.map(seg => {
    const segDist = seg.end - seg.start;
    const segPaceSec = Math.round(paceSec * seg.factor);
    const segTimeSec = segPaceSec * segDist;
    cumTimeSec += segTimeSec;
    return {
      segment: `${seg.start}~${seg.end}km`,
      pace: secToPace(segPaceSec),
      segTime: secToTime(segTimeSec),
      cumTime: secToTime(cumTimeSec),
      note: seg.label,
      segTimeSec
    };
  });
}

// ── 에너지 보급 전략 ──
function calcGelStrategy(totalTimeSec, paceSec) {
  const gels = [];
  const firstGel = 45 * 60;  // 45분
  const interval = 32 * 60;  // 32분 간격
  let time = firstGel;
  let num = 1;
  while (time < totalTimeSec - 20 * 60) {
    const km = (time / paceSec).toFixed(1);
    gels.push({
      num, time: secToTime(time), km,
      note: num === 1 ? '첫 번째 — 위장 적응 위해 소량 섭취' :
            parseFloat(km) > 30 ? '후반 — 카페인 젤 권장' :
            parseFloat(km) > 25 ? '30km 벽 대비 — 반드시 섭취' : '수분과 함께 섭취'
    });
    time += interval;
    num++;
  }
  return gels;
}

// ══════════════════════════════════════
// 메인: 전략 생성
// ══════════════════════════════════════
async function generateStrategy(userId, goal, acts, daysLeft) {
  const phase = getTrainingPhase(goal.race_date);

  // ① 훈련 데이터 분석
  const training = analyzeTrainingData(acts);

  // ② 향상치 예측
  const improvement = estimateImprovementByRaceDay(daysLeft, phase, training.completeness);

  // ③ AI로 현실적 목표 도출
  const targets = await deriveRealisticTargets(goal, training, daysLeft, phase, improvement);

  // ④ 각 목표별 구간 전략 생성
  const t90 = targets.target90;
  const t80 = targets.target80;

  t90.splits = calc5KSplits(t90.paceSec, 90);
  t90.gels   = calcGelStrategy(t90.paceSec * 42.195, t90.paceSec);
  t90.totalTimeSec = t90.paceSec * 42.195;

  t80.splits = calc5KSplits(t80.paceSec, 80);
  t80.gels   = calcGelStrategy(t80.paceSec * 42.195, t80.paceSec);
  t80.totalTimeSec = t80.paceSec * 42.195;

  return {
    training,         // 훈련 분석 결과 (프론트에서 활용 가능)
    assessment: targets.assessment,
    userGoalFeasibility: targets.userGoalFeasibility,
    trainingAdvice: targets.trainingAdvice,
    improvement,
    phase,
    target90: t90,    // 90% 달성 가능 목표 (안전한 목표)
    target80: t80     // 80% 달성 가능 목표 (도전적 목표)
  };
}

// ══════════════════════════════════════
// API 핸들러
// ══════════════════════════════════════
export default async function handler(req, res) {
  // 인증
  const authHeader = req.headers.authorization || '';
  const isInternal = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isInternal) {
    const token = authHeader.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'apikey': process.env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` }
      });
      const userData = await verifyRes.json();
      if (!userData?.id) return res.status(403).json({ error: 'Forbidden' });
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  try {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'user_id required' });

    const profiles = await sbGet('profiles',
      `id=eq.${userId}&strava_access_token=not.is.null&select=id,telegram_chat_id`);
    if (!Array.isArray(profiles) || profiles.length === 0) {
      return res.json({ message: 'No profile found' });
    }

    const uid = profiles[0].id;
    const goals = await sbGet('goals', `user_id=eq.${uid}&order=created_at.desc&limit=1`);
    const goal = goals?.[0];
    if (!goal?.race_date) return res.json({ message: 'No race date' });

    const daysLeft = Math.ceil((new Date(goal.race_date) - new Date()) / 86400000);
    if (daysLeft < 0) return res.json({ message: 'Race already passed' });

    // 최근 3개월 활동 (Supabase activities 테이블)
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const recentActs = await sbGet('activities',
      `user_id=eq.${uid}&start_date=gte.${threeMonthsAgo}&order=start_date.desc&limit=100`);

    const strategy = await generateStrategy(
      uid, goal,
      Array.isArray(recentActs) ? recentActs : [],
      daysLeft
    );

    // 저장 (기존 삭제 후 재저장)
    await fetch(`${SUPABASE_URL}/rest/v1/race_strategies?user_id=eq.${uid}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    await sbPost('race_strategies', {
      user_id: uid,
      strategy_a: strategy.target90,  // A = 90% (안전)
      strategy_b: strategy.target80,  // B = 80% (도전)
      training_analysis: strategy.training,
      assessment: strategy.assessment,
      user_goal_feasibility: strategy.userGoalFeasibility,
      training_advice: strategy.trainingAdvice,
      race_date: goal.race_date,
      generated_at: new Date().toISOString()
    });

    // 텔레그램
    const profile = profiles[0];
    if (profile.telegram_chat_id && process.env.TELEGRAM_BOT_TOKEN) {
      const t90 = strategy.target90;
      const t80 = strategy.target80;
      const tr  = strategy.training;
      const msg =
        `🏁 <b>레이스 전략 업데이트</b>\n─────────\n` +
        `📊 <b>현재 체력 분석</b>\n` +
        `훈련 페이스: ${tr.fitnessPace}/km | 완성도: ${tr.completeness}/100\n` +
        `주간 평균: ${tr.weeklyAvgKm}km | 최장 LSD: ${tr.longestLsdKm}km\n\n` +
        `${strategy.assessment}\n\n` +
        `✅ <b>전략 A — 90% 달성 목표</b>\n` +
        `${t90.targetTime} (${secToPace(t90.paceSec)}/km)\n${t90.keyPoint}\n\n` +
        `🔥 <b>전략 B — 80% 달성 목표</b>\n` +
        `${t80.targetTime} (${secToPace(t80.paceSec)}/km)\n${t80.keyPoint}\n\n` +
        `💡 <b>남은 훈련 핵심</b>\n${strategy.trainingAdvice}`;

      const truncated = msg.length > 4096 ? msg.substring(0, 4090) + '...' : msg;
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: profile.telegram_chat_id, text: truncated, parse_mode: 'HTML' })
      });
    }

    res.json({ success: true, userId: uid, strategy });

  } catch (error) {
    console.error('Race strategy error:', error.message);
    res.status(500).json({ error: error.message });
  }
}
