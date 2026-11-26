// 매주 월요일 오전 8시 자동 실행
// 모든 Strava 연동 사용자에게 주간 분석 발송 + PR 자동 갱신

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  // Vercel Cron 인증 확인
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Strava 연동된 모든 사용자 가져오기
    const profilesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?strava_access_token=not.is.null&select=id`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );
    const profiles = await profilesRes.json();

    if (!Array.isArray(profiles) || profiles.length === 0) {
      return res.json({ message: 'No users to process' });
    }

    // ① 주간 분석 발송
    const weeklyResults = [];
    for (const profile of profiles) {
      try {
        const syncRes = await fetch(
          `https://runai-coach.vercel.app/api/strava-sync?user_id=${profile.id}&type=weekly`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` }
          }
        );
        const data = await syncRes.json();
        weeklyResults.push({ userId: profile.id, status: 'success', data });
      } catch (e) {
        weeklyResults.push({ userId: profile.id, status: 'error', error: e.message });
      }
    }

    // ② PR 자동 갱신
    let prResult = null;
    try {
      const prRes = await fetch(
        `https://runai-coach.vercel.app/api/cron-pr-update`,
        {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` }
        }
      );
      prResult = await prRes.json();
    } catch (e) {
      prResult = { error: e.message };
    }

    res.json({
      success: true,
      processed: profiles.length,
      weekly: weeklyResults,
      prUpdate: prResult
    });

  } catch (error) {
    console.error('Weekly cron error:', error);
    res.status(500).json({ error: error.message });
  }
}
