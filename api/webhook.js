import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { message } = req.body || {};

  // If there's no message, just return 200 to acknowledge receipt
  if (!message || !message.text) {
    return res.status(200).json({ ok: true });
  }

  const chatId = message.chat.id;
  const text = message.text.trim();

  // Process /stats command
  if (text === '/stats') {
    const token = process.env.TG_BOT_TOKEN;
    if (!token) return res.status(500).json({ error: 'No token' });

    try {
      const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date());
      
      const dailyVisits = parseInt(await redis.get(`stats:daily:visits:${dateStr}`)) || 0;
      const dailyNewUsers = parseInt(await redis.get(`stats:daily:new_users:${dateStr}`)) || 0;
      const totalVisits = parseInt(await redis.get('stats:total:visits')) || 0;
      const totalUsers = parseInt(await redis.get('stats:total:users')) || 0;

      const replyText = `
📊 <b>Поточна статистика:</b>

<b>Сьогодні (${dateStr}):</b>
🔹 Візитів: ${dailyVisits}
🆕 Нових користувачів: ${dailyNewUsers}

<b>За весь час:</b>
🔸 Всього візитів: ${totalVisits}
👥 Всього унікальних пристроїв: ${totalUsers}
      `.trim();

      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: replyText,
          parse_mode: 'HTML'
        })
      });

    } catch (error) {
      console.error('Webhook error processing /stats:', error);
    }
  }

  // Always return 200 so Telegram knows we received the message
  return res.status(200).json({ ok: true });
}
