const SUPABASE_URL = process.env.SUPABASE_URL;

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

  const prompt = `마라톤 코치로서 선수의 오늘 컨디션에 맞는 훈련 코칭을 해주세요.

선수 정보:
- 목표 페이스: ${target_pace}/km
- 훈련 단계: ${phase}
- 오늘 계획된 훈련: ${today_plan}

오늘 컨디션:
- 상태: ${condition}
- 부상: ${injury_part === '없음' ? '없음' : `${injury_part} (${injury_level})`}
${memo ? `- 메모: ${memo}` : ''}

300자 이내로 간결하게 작성:
1. 오늘 훈련 권장사항 (계획 수정 또는 유지)
2. 구체적인 훈련 처방 (종류/거리/페이스)
3. 주의사항 한 줄

${injury_part !== '없음' && injury_level === '심각' ? '⚠️ 심각한 부상이므로 반드시 휴식과 전문의 상담을 권고하세요.' : ''}`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await claudeRes.json();
    const coaching = data.content?.[0]?.text || '코칭을 불러올 수 없습니다.';

    res.json({ success: true, coaching });

  } catch(e) {
    console.error('Coaching error:', e);
    res.status(500).json({ error: e.message });
  }
}
