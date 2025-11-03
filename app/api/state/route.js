import { put, list } from '@vercel/blob';

function key(userId) {
  const today = new Date().toISOString().slice(0, 10);
  return `calorie-state/${userId}/${today}.json`;
}

const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

export async function GET(req) {
  try {
    const userId = req.nextUrl.searchParams.get('user_id') || 'anon';
    const k = key(userId);
    
    const { blobs } = await list({ prefix: k });
    if (!blobs || blobs.length === 0) {
      return Response.json({ userConfig: null, meals: [] });
    }

    const blob = blobs[0];
    const response = await fetch(blob.url, { cache: 'no-store' });
    if (!response.ok) {
      return Response.json({ userConfig: null, meals: [] });
    }

    const json = await response.json();
    if (json?.savedAt && Date.now() - json.savedAt > FORTY_EIGHT_HOURS) {
      return Response.json({ userConfig: null, meals: [] });
    }
    return Response.json(json);
  } catch {
    return Response.json({ userConfig: null, meals: [] });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const userId = body?.user_id || 'anon';
    const { userConfig, meals } = body || {};
    const k = key(userId);

    const safeMeals = Array.isArray(meals)
      ? meals.map((m) => ({ ...m, photos: [] }))
      : [];

    const payload = { 
      userConfig: userConfig || {}, 
      meals: safeMeals, 
      savedAt: Date.now() 
    };
    
    await put(k, JSON.stringify(payload), {
      contentType: 'application/json',
      access: 'public',
      addRandomSuffix: false,
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || 'save failed' }, { status: 500 });
  }
}
