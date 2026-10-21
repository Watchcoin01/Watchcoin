process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.MAX_ACCOUNTS_PER_IP = '50';
process.env.JWT_SECRET = 'test-secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/server');
const { db, getSetting } = require('../src/db');
const push = require('../src/push');

const sent = [];
push.transport.send = async (sub, payload) => { sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); };
let server, root, admin, ama, kofi;
before(() => new Promise((resolve) => { server = createApp().listen(0, () => { root = `http://127.0.0.1:${server.address().port}`; resolve(); }); }));
after(() => server.close());
async function call(method, p, { token, body } = {}) {
  const res = await fetch(`${root}/api${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; } return { status: res.status, body: json };
}
const signup = async (n, e) => (await call('POST', '/auth/signup', { body: { name: n, email: e, password: 'secret1' } })).body;
const subscription = (name) => ({ endpoint: `https://push.example/${name}`, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } });
const subscribe = (u, name) => call('POST', '/push/subscribe', { token: u.token, body: { subscription: subscription(name) } });

test('the notification key is made once and kept', async () => {
  admin = await signup('Boss', 'admin@test.com'); ama = await signup('Ama', 'ama@test.com'); kofi = await signup('Kofi', 'kofi@test.com');
  const a = (await call('GET', '/push/key', { token: ama.token })).body.publicKey;
  assert.match(a, /^[A-Za-z0-9_-]{80,100}$/);
  assert.equal((await call('GET', '/push/key', { token: kofi.token })).body.publicKey, a); // the same key for everyone, every time
  assert.equal(getSetting('vapid_public'), a); assert.ok(getSetting('vapid_private').length > 30); // saved, so a restart does not break people's phones
  assert.equal((await call('GET', '/push/key')).status, 401);
});

test('a phone can sign up, and only proper addresses are accepted', async () => {
  assert.equal((await call('POST', '/push/subscribe', { token: ama.token, body: { subscription: { endpoint: 'http://insecure.example/x', keys: subscription('a').keys } } })).status, 400);
  assert.equal((await call('POST', '/push/subscribe', { token: ama.token, body: { subscription: { endpoint: 'https://push.example/a' } } })).status, 400);
  assert.equal((await call('POST', '/push/subscribe', { token: ama.token, body: {} })).status, 400);
  assert.equal((await subscribe(ama, 'ama-phone')).status, 201);
  assert.equal((await subscribe(ama, 'ama-phone')).status, 201); // the same phone twice is one entry
  assert.equal(db.prepare('SELECT COUNT(*) c FROM push_subscriptions').get().c, 1);
  assert.equal((await subscribe(kofi, 'ama-phone')).status, 201); // a phone that changes account moves with it
  assert.equal(db.prepare('SELECT user_id FROM push_subscriptions').get().user_id, kofi.user.id);
});

test('each person keeps at most five phones', async () => {
  for (let i = 1; i <= 7; i++) await subscribe(ama, `phone-${i}`);
  const rows = db.prepare('SELECT endpoint FROM push_subscriptions WHERE user_id=? ORDER BY id').all(ama.user.id).map((r) => r.endpoint.split('/').pop());
  assert.deepEqual(rows, ['phone-3', 'phone-4', 'phone-5', 'phone-6', 'phone-7']); // the oldest ones went
});

test('a test notification reaches every phone on the account, and fails clearly with none', async () => {
  sent.length = 0;
  const r = await call('POST', '/push/test', { token: ama.token });
  assert.equal(r.status, 200); assert.equal(r.body.sent, 5); assert.equal(sent.length, 5); assert.equal(sent[0].tag, 'test');
  db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(kofi.user.id);
  assert.equal((await call('POST', '/push/test', { token: kofi.token })).status, 404);
});

test('turning notifications off removes only your own phone', async () => {
  await subscribe(kofi, 'kofi-phone');
  assert.equal((await call('POST', '/push/unsubscribe', { token: ama.token, body: { endpoint: 'https://push.example/kofi-phone' } })).status, 200); // not Ama's, so nothing happens
  assert.equal(db.prepare("SELECT COUNT(*) c FROM push_subscriptions WHERE endpoint='https://push.example/kofi-phone'").get().c, 1);
  await call('POST', '/push/unsubscribe', { token: kofi.token, body: { endpoint: 'https://push.example/kofi-phone' } });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM push_subscriptions WHERE endpoint='https://push.example/kofi-phone'").get().c, 0);
});

test('an announcement can also buzz phones, only when the admin asks', async () => {
  await subscribe(kofi, 'kofi-phone');
  db.prepare('UPDATE users SET plan=1, plan_exp=? WHERE id=?').run(Date.now() + 864e5, kofi.user.id);
  sent.length = 0;
  assert.equal((await call('POST', '/admin/broadcasts', { token: admin.token, body: { message: 'Quiet one', audience: 'all' } })).status, 201);
  await new Promise((r) => setTimeout(r, 100)); assert.equal(sent.length, 0);
  const loud = await call('POST', '/admin/broadcasts', { token: admin.token, body: { message: 'New videos today!', audience: 'premium', push: true } });
  assert.equal(loud.body.recipients, 1);
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(sent.map((s) => [s.endpoint, s.body, s.tag]), [['https://push.example/kofi-phone', 'New videos today!', 'announcement']]);
  assert.ok((await call('GET', '/admin/audit', { token: admin.token })).body.entries.some((e) => /with phone notification/.test(e.detail)));
});

test('the files that make the app installable are served correctly', async () => {
  const m = await fetch(`${root}/manifest.webmanifest`);
  assert.equal(m.status, 200); assert.match(m.headers.get('content-type'), /manifest\+json|application\/json/);
  const man = await m.json();
  assert.equal(man.display, 'standalone'); assert.equal(man.start_url, '/'); assert.ok(man.name && man.short_name);
  const sizes = man.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512')); assert.ok(man.icons.some((i) => i.purpose === 'maskable'));
  for (const i of man.icons) { const r = await fetch(root + i.src); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png'); assert.ok((await r.arrayBuffer()).byteLength > 1000); }
  assert.equal((await fetch(`${root}/apple-touch-icon.png`)).status, 200);

  const sw = await fetch(`${root}/sw.js`);
  assert.equal(sw.status, 200); assert.match(sw.headers.get('content-type'), /javascript/);
  const code = await sw.text();
  for (const needle of ['addEventListener(\'push\'', 'showNotification', 'notificationclick', "startsWith('/api/')"]) assert.ok(code.includes(needle), `sw.js should contain ${needle}`);
  const html = await (await fetch(root)).text();
  for (const tag of ['rel="manifest"', 'rel="apple-touch-icon"', 'apple-mobile-web-app-capable']) assert.ok(html.includes(tag), `page should have ${tag}`);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'icon-maskable-512.png')));
});
