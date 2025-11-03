import { NextRequest } from 'next/server';
import { put, get } from '@vercel/blob';

// Rolling 48h key — still per-day file name for simplicity, but we enforce 48h on read
function key(userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `calorie-state/${userId}/${today}.json`;
}

const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id') || 'anon';
  const k = key(userId);
  try {
    const file = await get(k);
    if (!file) return Response.json({ userConfig: null, meals: [] });
    const json = await (await fetch(file.url, { cache: 'no-store' })).json();
    if (json?.savedAt && Date.now() - json.savedAt > FORTY_EIGHT_HOURS) {
      return Response.json({ userConfig: null, meals: [] });
    }
    return Response.json(json);
  } catch {
    return Response.json({ userConfig: null, meals: [] });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const userId = body?.user_id || 'anon';
  const { userConfig, meals } = body || {};
  const k = key(userId);

  // Strip photos entirely from persistence
  const safeMeals = Array.isArray(meals)
    ? meals.map((m: any) => ({
        ...m,
        photos: [] // do not persist photos
      }))
    : [];

  const payload = { userConfig, meals: safeMeals, savedAt: Date.now() };
  await put(k, JSON.stringify(payload), {
    contentType: 'application/json',
    access: 'public',
    addRandomSuffix: false,
  });
  return Response.json({ ok: true });
}
