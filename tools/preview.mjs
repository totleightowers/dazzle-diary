// Serves the v2 app over HTTP so it can be opened in a normal browser at any
// width — the WebView is not the only place this layout has to be right.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const ROOT = '/home/julia/diamond-logbook/app';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.webmanifest':'application/manifest+json',
  '.woff2':'font/woff2', '.svg':'image/svg+xml', '.png':'image/png', '.txt':'text/plain' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const wanted = decodeURIComponent(url.pathname) === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  /* Resolve first, then check the result is still inside the directory being
     served. Stripping "../" off the front of the string is not enough: it
     leaves "a/../../etc/passwd" alone, and that resolves straight out. */
  const full = resolve(ROOT, '.' + wanted);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('outside the served directory');
    return;
  }
  const path = wanted;
  try {
    const body = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    try {
      const body = await readFile(join(ROOT, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(body);
    } catch { res.writeHead(404).end('not found'); }
  }
}).listen(8788, () => console.log('preview on http://localhost:8788'));
