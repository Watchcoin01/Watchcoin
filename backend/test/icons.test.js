// The app icon: every file the page and the install manifest point to must exist, be a real image, and be the right size.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/server');

let server, origin;
before(() => new Promise((resolve) => { server = createApp().listen(0, () => { origin = `http://127.0.0.1:${server.address().port}`; resolve(); }); }));
after(() => server.close());

const pngSize = (buf) => { assert.equal(buf.subarray(1, 4).toString(), 'PNG'); return [buf.readUInt32BE(16), buf.readUInt32BE(20)]; };
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('the manifest is valid and lists a normal and a maskable icon that exist at the stated size', async () => {
  const res = await fetch(`${origin}/manifest.webmanifest`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /manifest\+json|application\/json/);
  const m = await res.json();
  assert.equal(m.name, 'Watchcoin');
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'));
  for (const i of m.icons) {
    const r = await fetch(origin + i.src);
    assert.equal(r.status, 200, i.src);
    assert.equal(r.headers.get('content-type'), 'image/png');
    const [w, h] = pngSize(Buffer.from(await r.arrayBuffer()));
    assert.equal(`${w}x${h}`, i.sizes, i.src);
  }
});

test('every icon the page links to is served', async () => {
  const hrefs = [...html.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon|manifest)"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 5, `expected icon links in the page, found ${hrefs.length}`);
  for (const h of hrefs) assert.equal((await fetch(origin + h)).status, 200, h);
});

test('favicon.ico holds 16, 32 and 48 pixel images, and the phone icon is 180x180', async () => {
  const ico = Buffer.from(await (await fetch(`${origin}/favicon.ico`)).arrayBuffer());
  assert.equal(ico.readUInt16LE(2), 1); // type: icon
  const count = ico.readUInt16LE(4), sizes = [];
  for (let i = 0; i < count; i++) sizes.push(ico[6 + i * 16] || 256);
  assert.deepEqual(sizes.sort((a, b) => a - b), [16, 32, 48]);
  const apple = Buffer.from(await (await fetch(`${origin}/icons/apple-touch-icon.png`)).arrayBuffer());
  assert.deepEqual(pngSize(apple), [180, 180]);
});
