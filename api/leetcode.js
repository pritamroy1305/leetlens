import { getProfile } from '../lib/leetcode.js';
import { query, send, sendError } from '../lib/http.js';

export default async function handler(req, res) {
  try {
    const data = await getProfile(query(req).get('username'));
    send(res, 200, data, { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800' });
  } catch (err) {
    sendError(res, err);
  }
}
