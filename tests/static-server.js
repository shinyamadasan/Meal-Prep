/**
 * Serves THIS checkout over http://127.0.0.1 for the local Playwright project.
 *
 * Why the local suite is not loaded from file:// any more (TASK-061):
 * Chromium intermittently DROPS a fresh browser context's entire file:// localStorage across
 * that context's first reload. Measured with the real app and Firebase aborted, 16 workers:
 * save the document, reload ~0.4s after the context's first navigation, and in about 3 of
 * every 1000 runs the new document starts with an EMPTY localStorage — every key, including
 * ones written at the very first navigation — while sessionStorage in the same tab survives
 * and a second reload does not bring the data back. The identical probe over http lost
 * nothing. Every "restore wait timed out after reload" CI failure since 2026-08-25 has that
 * shape: one fresh context, one quick save, one reload, and a restored state that is simply
 * not there — so no amount of waiting after the reload could ever have passed.
 *
 * Deliberately tiny and dependency-free: static files from the repo root, nothing else.
 * No caching, so a test never sees a stale app.js; no directory listing; nothing outside
 * the repo root is reachable.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.LOCAL_APP_PORT) || 47813;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { rel = null; }
  const file = rel && path.resolve(ROOT, '.' + (rel === '/' ? '/index.html' : rel));
  if (!file || !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  });
}).listen(PORT, '127.0.0.1', () => console.log('local app on http://127.0.0.1:' + PORT));
