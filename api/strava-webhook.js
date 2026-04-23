// Strava Webhook Handler
// Strava가 운동 기록 업로드 시 자동 호출

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const STRAVA_VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN; // 임의 문자열

export default async function handler(req, res) {

  // ── GET: Strava Webhook 구독 검증 ──
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === STRAVA_VERIFY_TOKEN) {
      console.log('Strava webhook verified');
      return res.json({ 'hub.challenge': challenge });
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  // ── POST: 실제 Webhook 이벤트 수신 ──
  if (req.method === 'POST') {
    const event = req.body;
    console.log('Strava webhook event:', JSON.stringify(event));

    // 새 활동 생성 이벤트만 처리
    if (event.object_type !== 'activity' || event.aspect_type !== 'create') {
      return res.status(200).json({ ok: true });
    }

    const stravaAthleteId = String(event.owner_id);
    const activityId = event.object_id;

    try {
      // Strava athlete_id로 사용자 찾기
      const profilesRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?strava_athlete_id=eq.${stravaAthleteId}&select=id,strava_access_token,strava_refresh_token,telegram_chat_id`,
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
          }
        }
      );
      const profiles = await profilesRes.json();

      if (!Array.isArray(profiles) || profiles.length === 0) {
        console.log('No user found for athlete:', stravaAthleteId);
        return res.status(200).json({ ok: true });
      }

      const profile = profiles[0];

      // 해당 사용자의 strava-sync 호출
      fetch(
        `https://runai-coach.vercel.app/api/strava-sync?user_id=${profile.id}&type=daily&activity_id=${activityId}`,
        { method: 'POST' }
      ).catch(e => console.error('Sync error:', e));

      // Strava는 빠른 응답을 기대하므로 즉시 200 반환
      return res.status(200).json({ ok: true });

    } catch (error) {
      console.error('Webhook error:', error);
      return res.status(200).json({ ok: true }); // 항상 200 반환
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
