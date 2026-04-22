export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const { message } = req.body;

  if (!message) return res.status(200).json({ ok: true });

  const chatId = message.chat.id;
  const text = message.text || '';

  // /start 명령어 처리
  if (text.startsWith('/start')) {
    const replyText = 
      `👋 안녕하세요! BaBa School AI 코치입니다.\n\n` +
      `📱 당신의 Chat ID는:\n\n` +
      `<code>${chatId}</code>\n\n` +
      `위 번호를 복사해서 BaBa School 앱의\n` +
      `⚙️ 설정 → 텔레그램 Chat ID 에 붙여넣으세요!\n\n` +
      `운동 완료 후 AI 분석 결과를 이곳으로 받아볼 수 있어요 🏃`;

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: replyText,
        parse_mode: 'HTML'
      })
    });
  }

  res.status(200).json({ ok: true });
}
