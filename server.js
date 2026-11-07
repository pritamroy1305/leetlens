// Zero-dependency local server: serves public/ and the two API routes.
// Run with `npm start` (or `node server.js`). Works on any Node host too
// (Render, Railway, a VPS). On Vercel, the api/ folder is used directly.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader so local dev needs no extra packages.
const envFile = path.join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const routes = {
  '/api/leetcode': (await import('./api/leetcode.js')).default,
  '/api/coach': (await import('./api/coach.js')).default,
};

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://local');
  if (routes[pathname]) return routes[pathname](req, res);

  const publicDir = path.join(root, 'public');
  let file = path.normalize(path.join(publicDir, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(publicDir)) { res.statusCode = 403; return res.end(); }
  if (!existsSync(file)) file = path.join(publicDir, 'index.html');
  try {
    const body = await readFile(file);
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`LeetLens running at http://localhost:${port}`);
  if (!process.env.GEMINI_API_KEY) console.log('Note: GEMINI_API_KEY is not set, so the coach panel will show a setup message.');
});
