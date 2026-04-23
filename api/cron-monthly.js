// 매월 1일 오전 8시 자동 실행
// 모든 Strava 연동 사용자에게 월간 분석 발송

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

    // 각 사용자에게 월간 분석 발송
    const results = [];
    for (const profile of profiles) {
      try {
        const syncRes = await fetch(
          `https://runai-coach.vercel.app/api/strava-sync?user_id=${profile.id}&type=monthly`,
          { method: 'POST' }
        );
        const data = await syncRes.json();
        results.push({ userId: profile.id, status: 'success', data });
      } catch (e) {
        results.push({ userId: profile.id, status: 'error', error: e.message });
      }
    }

    res.json({ success: true, processed: profiles.length, results });

  } catch (error) {
    console.error('Monthly cron error:', error);
    res.status(500).json({ error: error.message });
  }
}
