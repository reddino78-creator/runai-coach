// api/strava-personal-key.js
// 개인 Strava Client ID/Secret 저장 API

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ENCRYPT_KEY = process.env.ENCRYPT_KEY || 'babaschool2024encrypt';

// AES-256-GCM 암호화
async function encrypt(text) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(ENCRYPT_KEY.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'AES-GCM' }, false, ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(text)
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, client_id, client_secret } = req.body;
  if (!user_id || !client_id || !client_secret) {
    return res.status(400).json({ error: 'Missing params' });
  }

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
    if (!userData?.id || userData.id !== user_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } catch(e) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Client Secret 암호화 후 저장
  const encryptedSecret = await encrypt(client_secret);

  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user_id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      personal_client_id: client_id,
      personal_client_secret: encryptedSecret
    })
  });

  res.json({ success: true });
}
