export default async function handler(req, res) {
  // Origin 체크 - 허용된 도메인만 접근 가능
  const allowedOrigins = [
    'https://runai-coach.vercel.app',
    'http://localhost:3000' // 개발 환경
  ];

  const origin = req.headers.origin || req.headers.referer || '';
  const isAllowed = allowedOrigins.some(o => origin.startsWith(o));

  if (!isAllowed) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 캐시 금지
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY
  });
}
