// 매시간 자동 실행 - 모든 사용자 Strava 동기화

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  // 인증 체크
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Strava 연동된 모든 사용자 조회
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
      return res.json({ message: 'No connected users', synced: 0 });
    }

    const results = [];

    for (const profile of profiles) {
      try {
        const syncRes = await fetch(
          `https://runai-coach.vercel.app/api/strava-sync?user_id=${profile.id}`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` }
          }
        );
        const data = await syncRes.json();
        results.push({ userId: profile.id, synced: data.synced || 0 });
      } catch(e) {
        console.error(`Sync error for ${profile.id}:`, e.message);
        results.push({ userId: profile.id, error: e.message });
      }
    }

    const totalSynced = results.reduce((s, r) => s + (r.synced || 0), 0);
    res.json({ success: true, users: profiles.length, totalSynced, results });

  } catch(error) {
    console.error('Hourly cron error:', error);
    res.status(500).json({ error: error.message });
  }
}
