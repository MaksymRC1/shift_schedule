import { Redis } from '@upstash/redis';

// Initialize Redis from Upstash/KV environment variables
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Ensure Redis URL is configured
  if (!process.env.UPSTASH_REDIS_REST_URL && !process.env.KV_REST_API_URL) {
    return res.status(500).json({ error: 'Redis is not configured on this project' });
  }

  try {
    const { isFirstVisit, visitCount } = req.body || {};

    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date()); // YYYY-MM-DD in Kyiv time
    
    const pipeline = redis.pipeline();
    
    // Increment daily visits
    pipeline.incr(`stats:daily:visits:${dateStr}`);
    // Increment total visits
    pipeline.incr('stats:total:visits');

    // If it's a completely new user
    if (isFirstVisit) {
      pipeline.incr(`stats:daily:new_users:${dateStr}`);
      pipeline.incr('stats:total:users');
    }

    await pipeline.exec();

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error in track-visit:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
