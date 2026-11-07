// Builds a compact text summary of a profile and asks Gemini for
// personalized coaching. The API key never leaves the server, and the
// server builds the profile summary itself, so the endpoint can't be used
// as a free general-purpose Gemini proxy.

import { HttpError } from './http.js';

// Rough solved-count targets for a typical SDE interview loop.
export const CORE_TOPICS = [
  ['Array', 40], ['String', 25], ['Hash Table', 25], ['Two Pointers', 15],
  ['Sliding Window', 10], ['Binary Search', 15], ['Stack', 12], ['Linked List', 10],
  ['Tree', 25], ['Depth-First Search', 20], ['Breadth-First Search', 15], ['Graph', 15],
  ['Heap (Priority Queue)', 10], ['Backtracking', 10], ['Dynamic Programming', 40],
  ['Greedy', 15], ['Trie', 5], ['Union Find', 5], ['Bit Manipulation', 8],
];

const DAY = 86400;

function calendarStats(map = {}) {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  const byDay = new Map();
  for (const [ts, c] of Object.entries(map)) {
    const d = Math.floor(Number(ts) / DAY) * DAY;
    byDay.set(d, (byDay.get(d) || 0) + Number(c));
  }
  const window = (from, to) => {
    let subs = 0, days = 0;
    for (let d = today - from * DAY; d > today - to * DAY; d -= DAY) {
      const c = byDay.get(d) || 0;
      subs += c;
      if (c) days++;
    }
    return { subs, days };
  };
  let streak = 0;
  let d = byDay.get(today) ? today : today - DAY;
  while (byDay.get(d)) { streak++; d -= DAY; }
  return { year: window(0, 365), last30: window(0, 30), prev30: window(30, 60), currentStreak: streak };
}

export function buildSummary(p) {
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const s = p.solved, t = p.totals;
  const cal = calendarStats(p.calendar?.map);
  const tags = p.tags ? [...p.tags.fundamental, ...p.tags.intermediate, ...p.tags.advanced] : [];
  const tagCount = Object.fromEntries(tags.map((x) => [x.name, x.solved]));
  const lines = [];

  lines.push(`Username: ${p.username}${p.profile.realName ? ` (${p.profile.realName})` : ''}`);
  if (p.profile.ranking) lines.push(`Global ranking: ${p.profile.ranking}`);
  lines.push(`Solved: ${s.all} of ${t.all} (Easy ${s.easy}/${t.easy}, Medium ${s.medium}/${t.medium}, Hard ${s.hard}/${t.hard})`);
  lines.push(`Difficulty mix: Easy ${pct(s.easy, s.all)}%, Medium ${pct(s.medium, s.all)}%, Hard ${pct(s.hard, s.all)}%`);
  if (p.beats) lines.push(`Beats: Easy ${p.beats.easy}%, Medium ${p.beats.medium}%, Hard ${p.beats.hard}%`);
  if (p.submissions.total) lines.push(`Accepted submissions ratio: ${pct(p.submissions.accepted, p.submissions.total)}% (${p.submissions.accepted}/${p.submissions.total})`);
  lines.push(`Last 365 days: ${cal.year.subs} submissions on ${cal.year.days} active days. Current streak ${cal.currentStreak} days, best streak ${p.calendar?.streak ?? 'unknown'}.`);
  lines.push(`Last 30 days: ${cal.last30.days} active days, ${cal.last30.subs} submissions. Previous 30 days: ${cal.prev30.days} active days, ${cal.prev30.subs} submissions.`);

  if (p.contest?.attended) {
    const last = p.contest.history.slice(-6).map((h) => h.rating).join(' > ');
    lines.push(`Contests: ${p.contest.attended} attended, rating ${p.contest.rating ?? 'n/a'}, top ${p.contest.topPercentage ?? 'n/a'}%. Recent ratings: ${last || 'n/a'}`);
  } else {
    lines.push('Contests: none attended.');
  }
  if (p.languages.length) lines.push(`Languages: ${p.languages.slice(0, 5).map((l) => `${l.name} ${l.solved}`).join(', ')}`);
  if (tags.length) {
    const top = [...tags].sort((a, b) => b.solved - a.solved).slice(0, 25);
    lines.push(`Topic counts: ${top.map((x) => `${x.name} ${x.solved}`).join(', ')}`);
    const gaps = CORE_TOPICS.filter(([n, target]) => (tagCount[n] || 0) < target * 0.5)
      .map(([n, target]) => `${n} ${tagCount[n] || 0}/${target}`);
    if (gaps.length) lines.push(`Core interview topics under half of target: ${gaps.join(', ')}`);
  }
  if (p.recent.length) {
    lines.push(`Recent accepted: ${p.recent.slice(0, 10).map((r) => `${r.title} (${new Date(r.time * 1000).toISOString().slice(0, 10)}, ${r.lang})`).join('; ')}`);
  }
  if (p.profile.skillTags?.length) lines.push(`Self-listed skills: ${p.profile.skillTags.slice(0, 10).join(', ')}`);
  return lines.join('\n');
}

const SYSTEM = `You are a sharp, kind DSA and interview coach reviewing someone's LeetCode profile.
Use the real numbers in the profile. Be specific and honest: name the weak spots clearly, and do not pad with generic advice.
Recommend real, well-known LeetCode problems by their exact title.
Write in plain, conversational English, the way a senior engineer talks to a junior friend. Keep sentences short. Do not use em dashes.
Today's date: ${new Date().toISOString().slice(0, 10)}.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    level: { type: 'STRING', description: 'Two or three word level label, e.g. "Building fundamentals"' },
    headline: { type: 'STRING', description: 'One sentence verdict on where they stand right now' },
    strengths: { type: 'ARRAY', items: { type: 'STRING' }, description: '2 to 3 short strengths backed by numbers' },
    gaps: { type: 'ARRAY', items: { type: 'STRING' }, description: '2 to 4 short problems with the account, most important first' },
    plan: {
      type: 'ARRAY',
      description: '3 to 5 concrete actions for the next 2 weeks',
      items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, detail: { type: 'STRING' } }, required: ['title', 'detail'] },
    },
    nextProblems: {
      type: 'ARRAY',
      description: 'Exactly 6 LeetCode problems to solve next, targeting the gaps',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          difficulty: { type: 'STRING', enum: ['Easy', 'Medium', 'Hard'] },
          topic: { type: 'STRING' },
          why: { type: 'STRING' },
        },
        required: ['title', 'difficulty', 'topic', 'why'],
      },
    },
    weeklyTarget: { type: 'STRING', description: 'A realistic weekly target, e.g. "12 problems: 3 Easy, 7 Medium, 2 Hard"' },
  },
  required: ['level', 'headline', 'strengths', 'gaps', 'plan', 'nextProblems', 'weeklyTarget'],
};

async function callGemini({ system, contents, schema, maxOutputTokens = 8192 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(503, 'The coach is not set up yet. Add GEMINI_API_KEY to the server environment.', 'COACH_NOT_CONFIGURED');
  // Main model first, then a lighter fallback that is usually less busy.
  const primary = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const fallback = process.env.GEMINI_FALLBACK_MODEL || 'gemini-flash-lite-latest';
  const models = [...new Set([primary, fallback].filter(Boolean))];

  // Whole call must finish inside the serverless time limit (60s on Vercel).
  const deadline = Date.now() + 55000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastProblem = 'busy';

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    // Optional settings get dropped one by one if a model rejects them (HTTP 400).
    const opts = { thinking: true, schema: !!schema };

    for (let attempt = 0; attempt < 4; attempt++) {
      const left = deadline - Date.now();
      if (left < 4000) break;

      const generationConfig = { maxOutputTokens };
      if (schema) {
        generationConfig.responseMimeType = 'application/json';
        if (opts.schema) generationConfig.responseSchema = schema;
      }
      // Less thinking means much faster answers; coaching doesn't need deep reasoning.
      if (opts.thinking) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
      const body = { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig };

      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.min(30000, left - 1000)),
        });
      } catch (err) {
        console.warn(`Gemini ${model} ${err.name === 'TimeoutError' ? 'timed out' : 'network error'} (attempt ${attempt + 1})`);
        lastProblem = 'slow';
        break; // a slow model tends to stay slow, so move to the fallback
      }

      if (res.ok) {
        const json = await res.json();
        const parts = json.candidates?.[0]?.content?.parts || [];
        const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('').trim();
        if (text) return text;
        lastProblem = 'empty';
        continue;
      }

      const detail = await res.text().catch(() => '');
      if (res.status === 400 && (opts.thinking || opts.schema)) {
        if (opts.thinking) opts.thinking = false; else opts.schema = false;
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new HttpError(502, 'Gemini rejected the API key. Check GEMINI_API_KEY.');
      if (res.status === 404) { console.warn(`Gemini model "${model}" not found, trying next`); lastProblem = 'model'; break; }
      if (res.status === 429 || res.status >= 500) {
        console.warn(`Gemini ${model} returned ${res.status} (attempt ${attempt + 1})`);
        lastProblem = res.status === 429 ? 'quota' : 'busy';
        if (attempt >= 1) break; // one retry on this model, then fall back
        await sleep(1200 + Math.random() * 800);
        continue;
      }
      console.error('Gemini error', model, res.status, detail.slice(0, 500));
      lastProblem = 'other';
      break;
    }
  }

  const messages = {
    busy: "Gemini's servers are busy right now. Give it a minute and tap Try again.",
    slow: 'Gemini is responding slowly right now. Give it a minute and tap Try again.',
    quota: 'This Gemini key has hit its usage limit for now. Try again later.',
    model: 'None of the configured Gemini models were found. Set GEMINI_MODEL to a model your key can use.',
    empty: 'Gemini returned an empty answer. Try again.',
    other: 'Gemini could not answer right now. Try again.',
  };
  throw new HttpError(lastProblem === 'quota' ? 429 : 503, messages[lastProblem]);
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  throw new HttpError(502, 'Gemini answered in an unexpected format. Try again.');
}

const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const str = (v, n = 400) => String(v ?? '').slice(0, n);

export async function getCoaching(profile) {
  const summary = buildSummary(profile);
  const text = await callGemini({
    system: SYSTEM,
    schema: SCHEMA,
    contents: [{ role: 'user', parts: [{ text: `Here is the profile. Diagnose it and coach me.\n\n${summary}` }] }],
  });
  const c = parseJson(text);
  return {
    level: str(c.level, 40),
    headline: str(c.headline, 300),
    strengths: arr(c.strengths, 3).map((x) => str(x, 240)),
    gaps: arr(c.gaps, 4).map((x) => str(x, 240)),
    plan: arr(c.plan, 5).map((x) => ({ title: str(x?.title, 80), detail: str(x?.detail, 320) })),
    nextProblems: arr(c.nextProblems, 6).map((x) => ({
      title: str(x?.title, 100),
      difficulty: ['Easy', 'Medium', 'Hard'].includes(x?.difficulty) ? x.difficulty : 'Medium',
      topic: str(x?.topic, 40),
      why: str(x?.why, 200),
    })),
    weeklyTarget: str(c.weeklyTarget, 160),
  };
}

export async function askCoach(profile, question, history = []) {
  const q = str(question, 400).trim();
  if (!q) throw new HttpError(400, 'Ask the coach something first.');
  const turns = arr(history, 8)
    .filter((h) => h && (h.role === 'user' || h.role === 'model') && h.text)
    .map((h) => ({ role: h.role, parts: [{ text: str(h.text, 1500) }] }));
  const system = `${SYSTEM}
Answer follow-up questions about this person's profile only (DSA practice, LeetCode, interview prep, contests). If asked something unrelated, steer back politely.
Keep answers under 180 words. Use short paragraphs or a short list with "- " bullets. No markdown headings.

Profile:
${buildSummary(profile)}`;
  return callGemini({ system, contents: [...turns, { role: 'user', parts: [{ text: q }] }], maxOutputTokens: 4096 });
}