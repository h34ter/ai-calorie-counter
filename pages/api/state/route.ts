import type { NextApiRequest, NextApiResponse } from 'next';
import { put, get } from '@vercel/blob';

function key(userId: string) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `calorie-state/${userId}/${today}.json`;
}

const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method || 'GET';

  if (method === 'GET') {
    try {
      const userId = (req.query.user_id as string) || 'anon';
      const k = key(userId);
      const file = await get(k);
      if (!file) return res.status(200).json({ userConfig: null, meals: [] });
      const json = await (await fetch(file.url, { cache: 'no-store' })).json();
      if (json?.savedAt && Date.now() - json.savedAt > FORTY_EIGHT_HOURS) {
        return res.status(200).json({ userConfig: null, meals: [] });
      }
      return res.status(200).json(json);
    } catch {
      return res.status(200).json({ userConfig: null, meals: [] });
    }
  }

  if (method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const userId = body?.user_id || 'anon';
      const { userConfig, meals } = body || {};
      const k = key(userId);

      // Strip photos completely
      const safeMeals = Array.isArray(meals)
        ? meals.map((m: any) => ({ ...m, photos: [] }))
        : [];

      const payload = { userConfig, meals: safeMeals, savedAt: Date.now() };
      await put(k, JSON.stringify(payload), {
        contentType: 'application/json',
        access: 'public',
        addRandomSuffix: false,
      });
      return res.status(200).json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message || 'save failed' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
