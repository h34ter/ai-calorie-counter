import { put, head } from '@vercel/blob';
import { NextApiRequest, NextApiResponse } from 'next';

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

if (!BLOB_TOKEN) {
  console.warn('BLOB_READ_WRITE_TOKEN is not set');
}

function getUserKey(req: NextApiRequest): string {
  const { user_id, date } = req.query;
  
  if (!user_id) {
    throw new Error('user_id is required');
  }
  
  // Use date-based storage format: user-state-{user_id}-{date}.json
  const dateStr = date || new Date().toISOString().split('T')[0];
  return `user-state-${user_id}-${dateStr}.json`;
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

        if (!response.ok) {
          if (response.status === 404) {
            return res.status(200).json({ meals: [] });
          }
          throw new Error(`Failed to fetch: ${response.statusText}`);
        }

        const state = await response.json();
        return res.status(200).json(state);
      } catch (error) {
        console.error('GET error:', error);
        return res.status(200).json({ meals: [] });
      }
    } else if (req.method === 'POST') {
      // Save state to Vercel Blob
      const state = req.body;

      const blob = await put(userKey, JSON.stringify(state), {
        access: 'public',
        token: BLOB_TOKEN,
        contentType: 'application/json',
      });

      return res.status(200).json({ success: true, url: blob.url });
    } else {
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }
  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error instanceof Error ? error.message : 'Unknown error' });
  }
}
