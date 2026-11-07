# LeetLens

A mobile-first LeetCode profile dashboard. Type a username (or paste a profile link) and get:

- Solved count with Easy / Medium / Hard split, acceptance rate and "beats" percentages
- A full-year submission heatmap, current and best streak, active days
- Instant rule-based insights ("Only 5% of solves are Hard", "Momentum has dropped", ...)
- Coverage of 19 core interview topics against a realistic target, weakest first
- Weekday and month activity charts
- Contest rating history, recent accepted problems, languages and badges
- An AI coach (Gemini) that diagnoses the account, gives a two-week plan, six next problems, a weekly target, and answers follow-up questions

No build step and no npm dependencies. Plain HTML/CSS/JS frontend, two small Node serverless functions.

## Project layout

```
public/index.html   the whole frontend (single file, inline CSS + JS)
api/leetcode.js     GET  /api/leetcode?username=...   profile data, normalized
api/coach.js        POST /api/coach {username}        AI coaching JSON
                    POST /api/coach {username, question, history}   follow-up answer
lib/leetcode.js     LeetCode GraphQL queries + normalization + 10 min cache
lib/coach.js        profile summary builder + Gemini call
lib/http.js         shared helpers, best-effort rate limiting
server.js           zero-dependency local / self-host server
```

## Run locally

Needs Node 18.17 or newer.

```bash
cp .env.example .env      # paste your Gemini key into GEMINI_API_KEY
npm start                 # http://localhost:3000
```

Open `http://localhost:3000/?u=Pritam_roy1305` to jump straight to a profile.

## Deploy on Vercel (free tier is enough)

1. Push this folder to a GitHub repo.
2. Import it on vercel.com. Framework preset: **Other**. No build command.
3. In Project Settings > Environment Variables add `GEMINI_API_KEY`.
4. Deploy. The `public/` folder is served as the site and `api/` becomes the functions.

It also runs on Render, Railway or any VPS with `npm start` (set `PORT` if needed).

## Environment variables

| Name | Required | What it does |
|---|---|---|
| `GEMINI_API_KEY` | for the coach | Your key from https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | no | Defaults to `gemini-flash-latest`. Pin a model if you want stable output |
| `PORT` | no | Local server port, default 3000 |

Without a Gemini key the whole dashboard still works; only the coach panel shows a setup message.

## Notes and limits

- The Gemini key stays on the server. The coach endpoint builds the prompt from the LeetCode data itself, so nobody can use your key for arbitrary prompts. It is also rate limited per IP (30 per hour, best effort on serverless).
- LeetCode's GraphQL API is public but unofficial. If they rename a field, only the affected section goes blank (each query runs separately) and the footer lists what was unavailable.
- LeetCode only exposes the last 20 accepted submissions publicly, so "Recently accepted" tops out at 20.
- Profile data is cached for 10 minutes on the server and at the Vercel edge. Coach output is cached per browser tab; the refresh button in the coach panel regenerates it.
- Topic targets are a rough bar for SDE interviews, edit `CORE_TOPICS` in `lib/coach.js` and `public/index.html` to change them.
