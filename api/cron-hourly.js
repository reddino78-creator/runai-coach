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

    // 모든 사용자 병렬 처리 (각각 독립적으로 실행)
    const syncPromises = profiles.map(profile =>
      fetch(
        `https://runai-coach.vercel.app/api/strava-sync?user_id=${profile.id}`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` }
        }
      )
      .then(r => r.json())
      .then(data => ({ userId: profile.id, synced: data.synced || 0 }))
      .catch(e => ({ userId: profile.id, error: e.message }))
    );

    // 즉시 응답 (타임아웃 방지)
    res.json({ success: true, users: profiles.length, message: '동기화 시작됨' });

    // 백그라운드에서 계속 실행
    await Promise.allSettled(syncPromises);

  } catch(error) {
    console.error('Hourly cron error:', error);
    res.status(500).json({ error: error.message });
  }
}
