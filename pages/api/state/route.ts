import { put, head } from '@vercel/blob';
import { NextApiRequest, NextApiResponse } from 'next';

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

if (!BLOB_TOKEN) {
  console.warn('BLOB_READ_WRITE_TOKEN is not set');
}

function getUserKey(req: NextApiRequest): string {
  // Use IP address or a session-based identifier
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' 
    ? forwarded.split(',')[0] 
    : req.socket.remoteAddress || 'unknown';
  return `user-state-${ip}.json`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const userKey = getUserKey(req);

    if (req.method === 'GET') {
      // Try to fetch existing state
      try {
        const response = await fetch(
          `https://blob.vercel-storage.com/${userKey}`,
          {
            headers: {
              'Authorization': `Bearer ${BLOB_TOKEN}`,
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          return res.status(200).json(data);
        } else if (response.status === 404) {
          // No state found, return empty
          return res.status(200).json({ meals: [], photos: [] });
        } else {
          throw new Error(`Blob fetch failed: ${response.status}`);
        }
      } catch (error) {
        console.error('Error fetching state:', error);
        // Return empty state on error
        return res.status(200).json({ meals: [], photos: [] });
      }
    } else if (req.method === 'POST') {
      const state = req.body;

      // Validate that state doesn't contain blob URLs or non-public URLs
      const stateStr = JSON.stringify(state);
      if (stateStr.includes('blob:') || stateStr.includes('data:')) {
        return res.status(400).json({ 
          error: 'State cannot contain blob or data URLs' 
        });
      }

      // Store state in Vercel Blob with 24h cache
      const blob = await put(userKey, JSON.stringify(state), {
        access: 'public',
        addRandomSuffix: false,
        cacheControlMaxAge: 86400, // 24 hours
        token: BLOB_TOKEN,
      });

      return res.status(200).json({ 
        success: true, 
        url: blob.url 
      });
    } else {
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }
  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
