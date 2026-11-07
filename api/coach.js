import { getProfile } from '../lib/leetcode.js';
import { getCoaching, askCoach } from '../lib/coach.js';
import { HttpError, readJson, rateLimit, send, sendError } from '../lib/http.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
    rateLimit(req, { limit: 30, windowMs: 60 * 60 * 1000 });
    const body = await readJson(req);
    const profile = await getProfile(body.username);
    if (body.question) {
      const answer = await askCoach(profile, body.question, body.history);
      send(res, 200, { answer });
    } else {
      const coach = await getCoaching(profile);
      send(res, 200, { coach });
    }
  } catch (err) {
    sendError(res, err);
  }
}
