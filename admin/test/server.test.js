process.env.API_URL = 'https://backend.example/api';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { server } = require('../server');

let port;
before(() => new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); })));
after(() => server.close());

// Sends the request line exactly as written, so odd addresses are not tidied up by a client library.
const raw = (target) => new Promise((resolve, reject) => {
  const s = net.connect(port, '127.0.0.1', () => s.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
  let out = '';
  s.on('data', (d) => { out += d; });
  s.on('end', () => resolve(Number(out.slice(9, 12))));
  s.on('error', reject);
});

test('malformed or hostile addresses get an error, not a crash', async () => {
  for (const target of ['/%', '/%E0%A4%A', '/%00', '/a%00b.js', '/..%2f..%2fetc/passwd', '//']) {
    const status = await raw(target);
    assert.ok([400, 403, 404, 200].includes(status), `${target} -> ${status}`);
  }
  assert.equal(await raw('/health'), 200); // still alive afterwards
});

test('files outside public/ are never served', async () => {
  assert.notEqual(await raw('/..%2fserver.js'), 200);
  assert.notEqual(await raw('/%2e%2e/server.js'), 200);
});

test('security headers are present', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

test('the tab icon files are served with the right type', async () => {
  for (const [url, type] of [['/favicon.ico', 'image/x-icon'], ['/icons/favicon-32.png', 'image/png'], ['/icons/apple-touch-icon.png', 'image/png']]) {
    const res = await fetch(`http://127.0.0.1:${port}${url}`);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers.get('content-type'), type, url);
  }
});
