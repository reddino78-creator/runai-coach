import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ENCRYPT_KEY = process.env.ENCRYPT_KEY || 'babaschool2024encrypt';

// AES-256-GCM 복호화
async function decrypt(encryptedText) {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(ENCRYPT_KEY.padEnd(32, '0').slice(0, 32));
    const key = await crypto.subtle.importKey(
      'raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']
    );
    const combined = Uint8Array.from(atob(encryptedText), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );
    return new TextDecoder().decode(decrypted);
  } catch(e) {
    console.error('Decrypt error:', e);
    return null;
  }
}

export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.redirect('/?error=missing_params');
  }

  try {
    const userId = state;

    // 개인 키 확인
    const { data: profile } = await supabase
      .from('profiles')
      .select('personal_client_id, personal_client_secret')
      .eq('id', userId)
      .single();

    let clientId = process.env.STRAVA_CLIENT_ID;
    let clientSecret = process.env.STRAVA_CLIENT_SECRET;

    // 개인 키가 있으면 사용, 없으면 에러
    if (profile?.personal_client_id && profile?.personal_client_secret) {
      const decryptedSecret = await decrypt(profile.personal_client_secret);
      if (decryptedSecret) {
        clientId = profile.personal_client_id;
        clientSecret = decryptedSecret;
        console.log('Using personal Strava API key for user:', userId);
      } else {
        return res.redirect('/?error=decrypt_failed');
      }
    } else {
      // 개인 키 없으면 공용 키 사용 (Strava 확장 승인 후 사용 가능)
      console.log('Using shared Strava API key for user:', userId);
    }

    // Strava 토큰 교환
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
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

    res.redirect('/?strava=connected');

  } catch (error) {
    console.error('Strava callback error:', error);
    res.redirect('/?error=server_error');
  }
}
