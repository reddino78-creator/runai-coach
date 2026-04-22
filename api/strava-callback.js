const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function updateProfile(userId, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(data)
  });
  return res;
}

export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.redirect('/?error=missing_params');
  }

  try {
    const userId = state;

    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenRes.json();

    if (tokenData.errors || !tokenData.access_token) {
      return res.redirect('/?error=strava_auth_failed');
    }

    const { access_token, refresh_token, athlete } = tokenData;

    await updateProfile(userId, {
      strava_access_token: access_token,
      strava_refresh_token: refresh_token,
      strava_athlete_id: String(athlete.id),
    });

    try {
      await fetch(`https://runai-coach.vercel.app/api/strava-sync?user_id=${userId}`, {
        method: 'POST'
      });
    } catch (e) {
      console.log('Sync failed:', e.message);
    }

    res.redirect('/?strava=connected');

  } catch (error) {
    console.error('Strava callback error:', error);
    res.redirect('/?error=server_error');
  }
}
