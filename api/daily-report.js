import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
});

export default async function handler(req, res) {
  // Can be called by Vercel Cron (GET) or manually (POST/GET)
  const authHeader = req.headers.authorization;
  
  // Basic security check: if it's not a cron request, require a secret token
  if (
    req.headers['user-agent'] !== 'vercel-cron/1.0' &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
    req.query.secret !== process.env.CRON_SECRET
  ) {
    // We allow it to pass if they don't have CRON_SECRET configured at all for simplicity,
    // but in production, they should set CRON_SECRET.
    if (process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  if (!process.env.UPSTASH_REDIS_REST_URL && !process.env.KV_REST_API_URL) {
    return res.status(500).json({ error: 'Redis is not configured on this project' });
  }

  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;

  if (!token || !chatId) {
    return res.status(500).json({ error: 'Telegram credentials missing' });
  }

  try {
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date());
    
    // Fetch stats
    const dailyVisits = parseInt(await redis.get(`stats:daily:visits:${dateStr}`)) || 0;
    const dailyNewUsers = parseInt(await redis.get(`stats:daily:new_users:${dateStr}`)) || 0;
    const totalVisits = parseInt(await redis.get('stats:total:visits')) || 0;
    const totalUsers = parseInt(await redis.get('stats:total:users')) || 0;

    const message = `
📊 <b>Щоденний звіт (Графік змін)</b>

<b>За сьогодні (${dateStr}):</b>
🔹 Візитів: ${dailyVisits}
🆕 Нових користувачів: ${dailyNewUsers}

<b>За весь час:</b>
🔸 Всього візитів: ${totalVisits}
👥 Всього унікальних пристроїв: ${totalUsers}
    `.trim();

    // Send to Telegram
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });

    const data = await response.json();
    if (!data.ok) {
      console.error('Telegram error:', data);
      return res.status(500).json({ error: 'Telegram error' });
    }

    return res.status(200).json({ ok: true, report: message });
  } catch (error) {
    console.error('Error generating daily report:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
