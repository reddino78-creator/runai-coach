import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.redirect('/?error=missing_params');
  }

  try {
    // state = user_id (Supabase)
    const userId = state;

    // Strava 토큰 교환
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

    if (tokenData.errors) {
      return res.redirect('/?error=strava_auth_failed');
    }

    const { access_token, refresh_token, athlete } = tokenData;

    // Supabase에 토큰 저장
    await supabase.from('profiles').upsert({
      id: userId,
      strava_access_token: access_token,
      strava_refresh_token: refresh_token,
      strava_athlete_id: String(athlete.id),
    });

    // 최근 활동 즉시 가져오기
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://runai-coach.vercel.app';
    await fetch(`${baseUrl}/api/strava-sync?user_id=${userId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` }
    });

    // 대시보드로 리다이렉트
    res.redirect('/?strava=connected');

  } catch (error) {
    console.error('Strava callback error:', error);
    res.redirect('/?error=server_error');
  }
}
