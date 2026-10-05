'use strict';
// Zero-dependency static file server for Heroku (serves ./public).
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'public');
const APEX = 'thushannmassthamizhan.media';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.webmanifest', '.txt', '.xml', '.svg']);

// Cache files in memory (the site is only a few hundred KB).
const cache = new Map();
function load(file) {
  const stat = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtime === stat.mtimeMs) return hit;
  const ext = path.extname(file).toLowerCase();
  const body = fs.readFileSync(file);
  const entry = {
    mtime: stat.mtimeMs,
    ext,
    body,
    gzip: COMPRESSIBLE.has(ext) ? zlib.gzipSync(body, { level: 9 }) : null,
    etag: '"' + stat.size.toString(16) + '-' + Math.round(stat.mtimeMs).toString(16) + '"',
  };
  cache.set(file, entry);
  return entry;
}

function send(res, status, headers, body, head) {
  res.writeHead(status, headers);
  res.end(head ? undefined : body);
}

const server = http.createServer((req, res) => {
  const head = req.method === 'HEAD';
  if (req.method !== 'GET' && !head) {
    return send(res, 405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain' }, 'Method Not Allowed');
  }

  // Always end up on https://www.<domain>/ (same host as sitemap.xml and the canonical tag).
  // Heroku terminates TLS, so plain http shows up in x-forwarded-proto.
  const hostHeader = req.headers.host || '';
  const bareHost = hostHeader.toLowerCase().split(':')[0];
  const toWww = bareHost === APEX;
  if (toWww || req.headers['x-forwarded-proto'] === 'http') {
    const target = toWww ? 'www.' + APEX : hostHeader;
    return send(res, 301, { Location: 'https://' + target + req.url }, '', head);
  }

  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch (e) { return send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad Request', head); }

  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT + path.sep)) {          // block ../ traversal
    return send(res, 403, { 'Content-Type': 'text/plain' }, 'Forbidden', head);
  }

  let entry;
  try {
    if (!fs.statSync(file).isFile()) throw new Error('not a file');
    entry = load(file);
  } catch (e) {
    const nf = path.join(ROOT, '404.html');
    const body = fs.existsSync(nf) ? fs.readFileSync(nf) : Buffer.from('404 Not Found');
    return send(res, 404, { 'Content-Type': fs.existsSync(nf) ? TYPES['.html'] : 'text/plain' }, body, head);
  }

  const headers = {
    'Content-Type': TYPES[entry.ext] || 'application/octet-stream',
    ETag: entry.etag,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // HTML: always revalidate. Icons/fonts/images: cache for a day.
    'Cache-Control': entry.ext === '.html' || entry.ext === '.webmanifest'
      ? 'no-cache'
      : 'public, max-age=86400',
    Vary: 'Accept-Encoding',
  };

  if (req.headers['if-none-match'] === entry.etag) return send(res, 304, headers, '', true);

  let body = entry.body;
  if (entry.gzip && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    body = entry.gzip;
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = body.length;
  send(res, 200, headers, body, head);
});

server.listen(PORT, () => console.log('Portfolio running on port ' + PORT));
