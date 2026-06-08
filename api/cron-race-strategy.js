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

function paceToSec(p) {
  if (!p || p === '-') return 0;
  const [m, s] = p.split(':').map(Number);
  return m * 60 + s;
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

function calcGelStrategy(totalTimeSec, paceSec) {
  const gels = [];
  const firstGel = 45 * 60;
  const interval = 32 * 60;
  let time = firstGel;
  let gelNum = 1;
  while (time < totalTimeSec - 20 * 60) {
    const km = Math.round((time / paceSec) * 10) / 10;
    gels.push({
      num: gelNum, time: secToTime(time), km: km.toFixed(1),
      note: gelNum === 1 ? '첫 번째 - 위장 적응 위해 소량' :
            km > 30 ? '후반 - 카페인 젤 권장' : '수분과 함께 섭취'
    });
    time += interval;
    gelNum++;
  }
  return gels;
}

function calc5KSplits(totalDistKm, paceSec, strategy) {
  const splits = [];
  const segments = Math.ceil(totalDistKm / 5);
  for (let i = 0; i < segments; i++) {
    const startKm = i * 5;
    const endKm = Math.min((i + 1) * 5, totalDistKm);
    const segDist = endKm - startKm;
    let segPace = paceSec;
    if (strategy === 'A') {
      if (i === 0) segPace = paceSec + 10;
      else if (i === 1) segPace = paceSec + 5;
      else if (i >= segments - 2) segPace = paceSec - 8;
    } else {
      if (i === 0) segPace = paceSec + 15;
      else if (i >= segments - 1) segPace = paceSec - 5;
      else segPace = paceSec + 5;
    }
    const segTimeSec = segPace * segDist;
    const cumTimeSec = splits.reduce((sum, s) => sum + s.segTimeSec, 0) + segTimeSec;
    splits.push({
      segment: `${startKm}~${endKm}km`, pace: secToPace(segPace),
      segTime: secToTime(segTimeSec), cumTime: secToTime(cumTimeSec),
      note: i === 0 ? '워밍업 페이스' : i === 1 ? '안정화 구간' :
            i >= segments - 2 ? '피니시 구간' : '목표 페이스 유지',
      segTimeSec
    });
  }
  return splits;
}

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
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function generateStrategy(userId, goal, recentActs) {
  const targetPaceSec = paceToSec(goal.target_pace || '5:27');
  const totalDist = 42.195;

  const runActs = recentActs.filter(a => {
    const type = a.sport_type || a.type || '';
    return !['수영','Swim','자전거','Ride','VirtualRide','EBikeRide'].includes(type);
  });

  const recentKm = runActs.slice(0, 20).reduce((s, a) => s + a.distance, 0) / 1000;
  const avgPaceSec = runActs.length > 0
    ? runActs.slice(0, 10).reduce((s, a) => s + a.moving_time / (a.distance / 1000), 0) / Math.min(10, runActs.length)
    : targetPaceSec * 1.15;

  const paceDiff = avgPaceSec - targetPaceSec;
  const paceDiffStr = paceDiff > 0 ? `${Math.round(paceDiff)}초 느림` : `${Math.abs(Math.round(paceDiff))}초 빠름`;

  const prompt = `마라톤 코치로서 선수의 현실적인 레이스 전략 페이스를 냉철하게 계산하세요.

선수 정보:
- 목표 기록: ${goal.target_time} (목표 페이스 ${goal.target_pace}/km)
- PR: 풀 ${goal.pr_full || '-'} / 하프 ${goal.pr_half || '-'} / 10K ${goal.pr_10k || '-'}
- 최근 4주 훈련량: ${recentKm.toFixed(0)}km
- 최근 평균 훈련 페이스: ${secToPace(avgPaceSec)}/km (목표 대비 ${paceDiffStr})

아래 JSON 형식으로만 응답하세요:
{
  "strategyA": { "targetTime": "H:MM:SS", "paceSec": 숫자, "probability": 80, "description": "2문장", "keyPoint": "1문장" },
  "strategyB": { "targetTime": "H:MM:SS", "paceSec": 숫자, "probability": 90, "description": "2문장", "keyPoint": "1문장" }
}`;

  let strategies;
  try {
    const result = await callClaude(prompt);
    const clean = result.replace(/```json|```/g, '').trim();
    strategies = JSON.parse(clean);
    const validatePace = (p) => p > 250 && p < 510;
    if (!validatePace(strategies.strategyA?.paceSec) || !validatePace(strategies.strategyB?.paceSec)) {
      throw new Error('Invalid pace range');
    }
  } catch(e) {
    const racePaceSec = avgPaceSec * 0.90;
    const aPaceSec = Math.round(racePaceSec);
    const bPaceSec = Math.round(racePaceSec + 15);
    strategies = {
      strategyA: { targetTime: secToTime(aPaceSec * totalDist), paceSec: aPaceSec, probability: 80, description: '현재 훈련 페이스 기반 최상 컨디션 전략.', keyPoint: '네거티브 스플릿으로 후반 가속' },
      strategyB: { targetTime: secToTime(bPaceSec * totalDist), paceSec: bPaceSec, probability: 90, description: '안전하고 확실한 완주 전략.', keyPoint: '이븐 페이스로 안정적 완주' }
    };
  }

  const stratA = strategies.strategyA;
  const stratB = strategies.strategyB;
  stratA.splits = calc5KSplits(totalDist, stratA.paceSec, 'A');
  stratA.gels = calcGelStrategy(stratA.paceSec * totalDist, stratA.paceSec);
  stratA.totalTimeSec = stratA.paceSec * totalDist;
  stratB.splits = calc5KSplits(totalDist, stratB.paceSec, 'B');
  stratB.gels = calcGelStrategy(stratB.paceSec * totalDist, stratB.paceSec);
  stratB.totalTimeSec = stratB.paceSec * totalDist;

  return { strategyA: stratA, strategyB: stratB };
}

export default async function handler(req, res) {
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
    } catch(e) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  try {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'user_id required' });

    const profiles = await sbGet('profiles', `id=eq.${userId}&strava_access_token=not.is.null&select=id,telegram_chat_id`);
    if (!Array.isArray(profiles) || profiles.length === 0) {
      return res.json({ message: 'No profile found' });
    }

    const uid = profiles[0].id;
    const goals = await sbGet('goals', `user_id=eq.${uid}&order=created_at.desc&limit=1`);
    const goal = goals?.[0];
    if (!goal?.race_date) return res.json({ message: 'No race date' });

    const daysLeft = Math.ceil((new Date(goal.race_date) - new Date()) / 86400000);
    if (daysLeft < 0) return res.json({ message: 'Race already passed' });

    const recentActs = await sbGet('activities', `user_id=eq.${uid}&order=start_date.desc&limit=30`);
    const strategy = await generateStrategy(uid, goal, Array.isArray(recentActs) ? recentActs : []);

    await fetch(`${SUPABASE_URL}/rest/v1/race_strategies?user_id=eq.${uid}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    await sbPost('race_strategies', {
      user_id: uid,
      strategy_a: strategy.strategyA,
      strategy_b: strategy.strategyB,
      race_date: goal.race_date
    });

    // 텔레그램 발송
    const profile = profiles[0];
    if (profile.telegram_chat_id && process.env.TELEGRAM_BOT_TOKEN) {
      const a = strategy.strategyA;
      const b = strategy.strategyB;
      const msg = `🏁 <b>레이스 전략 업데이트</b>\n─────────\n` +
        `🎯 <b>전략 A (80%)</b>\n목표: ${a.targetTime} · ${secToPace(a.paceSec)}/km\n${a.keyPoint}\n\n` +
        `✅ <b>전략 B (90%)</b>\n목표: ${b.targetTime} · ${secToPace(b.paceSec)}/km\n${b.keyPoint}`;
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: profile.telegram_chat_id, text: msg, parse_mode: 'HTML' })
      });
    }

    res.json({ success: true, userId: uid });

  } catch(error) {
    console.error('Race strategy error:', error.message);
    res.status(500).json({ error: error.message });
  }
}
