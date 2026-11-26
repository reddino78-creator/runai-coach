const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbGet(table, filter) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
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

// 텔레그램 HTML 모드: AI 답변의 <, >, & 를 처리하지 않으면 메시지 전체가 거부됨
function escapeTg(t) {
  return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendTelegram(chatId, message) {
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return;
  const send = (body) => fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const text = message.length > 4000 ? message.slice(0, 4000) : message;
  const r = await send({ chat_id: chatId, text, parse_mode: 'HTML' });
  if (!r.ok) await send({ chat_id: chatId, text: text.replace(/<\/?b>/g, '') }); // 실패 시 서식 없이
}

// 한국 시간 기준 (서버는 UTC — 그대로 쓰면 아침 9시 전 입력 시 요일·주가 틀어짐)
function kstNow() { return new Date(Date.now() + 9 * 60 * 60 * 1000); }
function getWeekStart() {
  const k = kstNow();
  const day = k.getUTCDay();
  k.setUTCDate(k.getUTCDate() - (day === 0 ? 6 : day - 1));
  return k.toISOString().split('T')[0];
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });

  // JWT 검증
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`
      }
    });
    const userData = await verifyRes.json();
    if (!userData?.id || userData.id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } catch(e) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { condition, injury_part, injury_level, memo, today_plan, target_pace, phase } = req.body;

  // 현재 주간 계획 가져오기
  const weekStart = getWeekStart();
  const plans = await sbGet('weekly_plans', `user_id=eq.${userId}&week_start=eq.${weekStart}`);
  const plan = plans?.[0];

  // 프로필 (텔레그램용)
  const profiles = await sbGet('profiles', `id=eq.${userId}&select=telegram_chat_id`);
  const chatId = profiles?.[0]?.telegram_chat_id;

  const days = ['mon','tue','wed','thu','fri','sat','sun'];
  const dayNames = ['월','화','수','목','금','토','일'];
  const kDow = kstNow().getUTCDay();
  const todayIdx = kDow === 0 ? 6 : kDow - 1;

  // 선수 기준값 (약점 프로파일에 저장된 현재 실력 기준 마라톤 페이스·심박 구간)
  const apRows = await sbGet('athlete_profiles', `user_id=eq.${userId}&select=metrics`);
  const m = apRows?.[0]?.metrics || {};
  const mpSec = m.currentMP ? m.currentMP.split(':').reduce((a, b) => a * 60 + Number(b), 0) : null;
  const ps = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  const paceGuide = mpSec
    ? `현재 마라톤 페이스 ${m.currentMP}/km 기준 — 회복 ${ps(mpSec + 80)}-${ps(mpSec + 100)} | 이지 ${ps(mpSec + 45)}-${ps(mpSec + 75)} | 템포 ${ps(mpSec - 20)}-${ps(mpSec - 12)}`
    : `목표 페이스 ${target_pace}/km (현재 실력 데이터 없음)`;
  const z = m.hrZones;
  const zoneGuide = z?.easy ? `심박: 이지 ${z.easy[0]}-${z.easy[1]} / 템포 ${z.threshold[0]}-${z.threshold[1]}` : '';
  const remainingKeys = days.slice(todayIdx);   // 오늘~일요일만 조정 가능 (지난 요일은 그대로)

  // 현재 주간 계획 요약
  const weekPlanSummary = plan
    ? days.map((d, i) => `${dayNames[i]}: ${plan[d] || '-'}`).join(', ')
    : '계획 없음';

  const prompt = `마라톤 코치로서 선수의 컨디션에 맞게 오늘 훈련과 이번 주 계획을 조정해주세요.

선수 정보:
- 훈련 페이스: ${paceGuide}
${zoneGuide ? `- ${zoneGuide}\n` : ''}- 훈련 단계: ${phase}
- 오늘(${dayNames[todayIdx]}요일) 계획: ${today_plan}
- 이번 주 계획: ${weekPlanSummary}

오늘 컨디션:
- 상태: ${condition}
- 부상: ${injury_part === '없음' ? '없음' : `${injury_part} (${injury_level})`}
${memo ? `- 메모: ${memo}` : ''}

아래 JSON 형식으로만 응답하세요:
{
  "coaching": "오늘 코칭 메시지 (200자 이내)",
  "weekly_adjustment": { ${remainingKeys.map(k => `"${k}": "훈련종류"`).join(', ')} },
  "adjustment_reason": "주간 계획 조정 이유 (100자 이내)",
  "changed": true
}

규칙:
- 부상(심각): 이번 주 모두 휴식 또는 수영만
- 부상(중간): 강도 높은 훈련 → 수영/자전거/이지런으로 대체
- 부상(경미): 해당 부위 부담 없는 훈련으로 조정
- 피로: 강도 낮추기, 인터벌/템포 → 이지런으로
- 좋음: 계획 유지 (changed: false)
- weekly_adjustment에는 오늘(${dayNames[todayIdx]})부터 일요일까지만 넣을 것. 지금 계획에서 바꿀 필요 없는 날은 기존 계획 그대로 적을 것
- 강훈련(인터벌·템포런·페이스주) 이틀 연속 금지, 처방 강도는 위 훈련 페이스·심박 기준
- 훈련 종류: 인터벌/템포런/페이스주/롱런/LSD/이지런/수영/자전거/휴식`;

  try {
    const text = (await askClaude(prompt, 500)) || '{}';
    const result = JSON.parse(text.replace(/```json|```/g, '').trim());

    // 주간 계획 업데이트
    const adjustment = {};
    for (const k of remainingKeys) if (result.weekly_adjustment?.[k]) adjustment[k] = String(result.weekly_adjustment[k]).slice(0, 20);
    if (result.changed && Object.keys(adjustment).length && plan) {
      await sbPatch('weekly_plans',
        `user_id=eq.${userId}&week_start=eq.${weekStart}`,
        adjustment
      );

      // 텔레그램 알림
      const conditionEmoji = condition === '좋음' ? '⚡' : condition === '피로' ? '😴' : '😊';
      const injuryText = injury_part !== '없음' ? `\n🚨 ${escapeTg(injury_part)} 부상(${escapeTg(injury_level)})` : '';
      await sendTelegram(chatId,
        `${conditionEmoji} <b>컨디션 반영 - 주간 계획 조정</b>${injuryText}\n─────────\n${escapeTg(result.coaching)}\n\n📅 <b>이번 주 조정된 계획</b>\n${escapeTg(result.adjustment_reason)}`
      );
    }

    res.json({
      success: true,
      coaching: result.coaching || '코칭을 불러올 수 없습니다.',
      weekly_adjustment: adjustment,
      adjustment_reason: result.adjustment_reason,
      changed: result.changed
    });

  } catch(e) {
    console.error('Coaching error:', e);
    res.status(500).json({ error: e.message });
  }
}
