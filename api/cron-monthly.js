// 매월 1일 오전 8시 자동 실행
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const profilesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?strava_access_token=not.is.null&select=id`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const profiles = await profilesRes.json();

    if (!Array.isArray(profiles) || profiles.length === 0) {
      return res.json({ message: 'No users to process' });
    }

    // 즉시 응답 (타임아웃 방지)
    res.json({ success: true, users: profiles.length, message: '월간 분석 시작됨' });

    // 백그라운드에서 병렬 처리
    await Promise.allSettled(profiles.map(profile =>
      fetch(
        `https://runai-coach.vercel.app/api/strava-sync?user_id=${profile.id}&type=monthly`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` } }
      ).catch(e => console.error(`Monthly error for ${profile.id}:`, e.message))
    ));

  } catch (error) {
    console.error('Monthly cron error:', error.message);
  }
}
