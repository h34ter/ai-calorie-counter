import { NextRequest } from 'next/server';
import { put, get } from '@vercel/blob';

// Use date per-user as the storage key:
function key(userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `calorie-state/${userId}/${today}.json`;
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id') || 'anon';
  const k = key(userId);
  try {
    const file = await get(k);
    if (!file) return Response.json({ userConfig: null, meals: [] });
    const json = await (await fetch(file.url, { cache: 'no-store' })).json();
    // If older than 24 hours, discard/reset
    if (json?.savedAt && Date.now() - json.savedAt > 86400000)
      return Response.json({ userConfig: null, meals: [] });
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

  // Only allow HTTPS photo URLs, never save blobs
  const safeMeals = Array.isArray(meals)
    ? meals.map((m: any) => ({
        ...m,
        photos: Array.isArray(m.photos)
          ? m.photos.map((p: any) => ({
              id: p.id,
              timestamp: p.timestamp,
              analyzed: !!p.analyzed,
              url: typeof p.url === 'string' && p.url.startsWith('https://') ? p.url : undefined
            })).filter((p: any) => !!p.url)
          : []
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
