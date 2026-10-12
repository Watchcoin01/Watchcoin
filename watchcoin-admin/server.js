// Tiny static file server for the admin dashboard. No dependencies.
// It serves /public, injects the API address from the environment as /config.js,
// and adds strict security headers (the dashboard is for admins only).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 4000;
const API_URL = (process.env.API_URL || '').trim().replace(/\/$/, '');
const PUB = path.join(__dirname, 'public');
let apiOrigin = '';
try { apiOrigin = new URL(API_URL).origin; } catch { /* API_URL missing or invalid, the login page will say so */ }

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png',
};
const SECURITY = {
  'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://i.ytimg.com; connect-src 'self' ${apiOrigin}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY, ...extra });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return send(res, 200, 'text/plain', 'ok');
  if (url.pathname === '/config.js') {
    return send(res, 200, TYPES['.js'], `window.ADMIN_CONFIG = ${JSON.stringify({ apiUrl: API_URL })};`, { 'Cache-Control': 'no-store' });
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB + path.sep) && file !== PUB) return send(res, 403, 'text/plain', 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) {
      if (path.extname(rel)) return send(res, 404, 'text/plain', 'Not found');
      return fs.readFile(path.join(PUB, 'index.html'), (e2, d2) => (e2 ? send(res, 404, 'text/plain', 'Not found') : send(res, 200, TYPES['.html'], d2, { 'Cache-Control': 'no-cache' })));
    }
    send(res, 200, TYPES[path.extname(file)] || 'application/octet-stream', data, { 'Cache-Control': path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=300' });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Watchcoin admin on http://localhost:${PORT}`);
    if (!apiOrigin) console.log('Warning: API_URL is not set. Set it to your backend address, for example https://your-backend.up.railway.app/api');
  });
}
module.exports = { server };
