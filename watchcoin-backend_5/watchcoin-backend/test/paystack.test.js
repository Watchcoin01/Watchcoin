// Paystack tests run against a fake Paystack server, so no real money or account is needed.
const http = require('http');
const crypto = require('crypto');
const PORT = 45000 + Math.floor(Math.random() * 900);
const SECRET = 'sk_test_abc123';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.MAX_ACCOUNTS_PER_IP = '50';
process.env.JWT_SECRET = 'test-secret';
process.env.PAYSTACK_SECRET_KEY = SECRET;
process.env.PAYSTACK_BASE_URL = `http://127.0.0.1:${PORT}`;
process.env.FRONTEND_URL = 'https://wc.example';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { db } = require('../src/db');

const initCalls = [], verdicts = {};
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== `Bearer ${SECRET}`) { res.statusCode = 401; return res.end('{"status":false,"message":"Invalid key"}'); }
    if (req.method === 'POST' && req.url === '/transaction/initialize') {
      const b = JSON.parse(raw); initCalls.push(b);
      return res.end(JSON.stringify({ status: true, data: { authorization_url: `https://checkout.paystack.test/${b.reference}`, access_code: 'ac', reference: b.reference } }));
    }
    const m = req.url.match(/^\/transaction\/verify\/(.+)$/);
    if (m) {
      const v = verdicts[decodeURIComponent(m[1])];
      if (!v) { res.statusCode = 404; return res.end('{"status":false,"message":"Transaction reference not found"}'); }
      return res.end(JSON.stringify({ status: true, data: { status: v.status, reference: decodeURIComponent(m[1]), amount: v.amount, currency: v.currency, channel: 'mobile_money' } }));
    }
    res.statusCode = 404; res.end('{}');
  });
});

let server, base;
before(() => new Promise((resolve) => {
  fake.listen(PORT, '127.0.0.1', () => { server = createApp().listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; resolve(); }); });
}));
after(() => { server.close(); fake.close(); });

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const signup = async (name, email) => (await call('POST', '/auth/signup', { body: { name, email, password: 'secret1' } })).body;
const webhook = (payload, { sign = true, sig } = {}) => {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signature = sig ?? crypto.createHmac('sha512', SECRET).update(body).digest('hex');
  return fetch(`${base}/webhooks/paystack`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sign ? { 'x-paystack-signature': signature } : {}) }, body });
};
const planOf = async (u) => (await call('GET', '/me', { token: u.token })).body.user.plan.name;
const start = async (u, plan = 1) => (await call('POST', '/premium/paystack/initialize', { token: u.token, body: { plan } })).body;

let admin, ama, kofi;

test('Paystack stays off until the exchange rate is set, then shows local prices', async () => {
  admin = await signup('Boss', 'admin@test.com'); ama = await signup('Ama', 'ama@test.com'); kofi = await signup('Kofi', 'kofi@test.com');
  assert.equal((await call('GET', '/premium', { token: ama.token })).body.paystack.enabled, false);
  assert.equal((await call('POST', '/premium/paystack/initialize', { token: ama.token, body: { plan: 1 } })).status, 503);

  assert.equal((await call('PUT', '/admin/settings', { token: admin.token, body: { paystackRate: 15 } })).status, 200);
  const info = (await call('GET', '/admin/settings', { token: admin.token })).body.paystack;
  assert.equal(info.configured, true); assert.equal(info.mode, 'test'); assert.equal(info.rate, 15); assert.match(info.webhookUrl, /\/api\/webhooks\/paystack$/);
  const p = (await call('GET', '/premium', { token: ama.token })).body.paystack;
  assert.equal(p.enabled, true); assert.equal(p.currency, 'GHS'); assert.deepEqual(p.prices, [0, 75, 225, 450]);
});

test('starting a payment asks Paystack for the right amount and records it', async () => {
  assert.equal((await call('POST', '/premium/paystack/initialize', { token: ama.token, body: { plan: 0 } })).status, 400);
  const r = await start(ama, 1);
  assert.match(r.reference, /^wtc-\d+-[0-9a-f]{16}$/); // only characters Paystack allows
  assert.equal(r.authorizationUrl, `https://checkout.paystack.test/${r.reference}`);
  const sent = initCalls.at(-1);
  assert.equal(sent.amount, 7500); assert.equal(sent.currency, 'GHS'); assert.equal(sent.email, 'ama@test.com'); assert.equal(sent.callback_url, 'https://wc.example/');
  assert.equal(db.prepare('SELECT status FROM payments WHERE reference=?').get(r.reference).status, 'pending');
});

test('forged or unsigned webhooks are rejected and give nothing', async () => {
  const ref = db.prepare('SELECT reference FROM payments ORDER BY id DESC').get().reference;
  verdicts[ref] = { status: 'success', amount: 7500, currency: 'GHS' };
  const evt = { event: 'charge.success', data: { reference: ref } };
  assert.equal((await webhook(evt, { sign: false })).status, 401);
  assert.equal((await webhook(evt, { sig: 'a'.repeat(128) })).status, 401);
  assert.equal(await planOf(ama), 'Free');
  delete verdicts[ref];
});

test('a webhook alone is not enough: Paystack must confirm the payment', async () => {
  const r = await start(ama, 1);
  verdicts[r.reference] = { status: 'abandoned', amount: 7500, currency: 'GHS' };
  assert.equal((await webhook({ event: 'charge.success', data: { reference: r.reference } })).status, 200);
  assert.equal(await planOf(ama), 'Free');
  assert.equal(db.prepare('SELECT status FROM payments WHERE reference=?').get(r.reference).status, 'abandoned');
});

test('a payment for the wrong amount is held for review and gives no plan', async () => {
  const r = await start(ama, 1);
  verdicts[r.reference] = { status: 'success', amount: 100, currency: 'GHS' }; // paid 1 GHS instead of 75
  const v = await call('POST', '/premium/paystack/verify', { token: ama.token, body: { reference: r.reference } });
  assert.equal(v.body.status, 'review');
  assert.equal(await planOf(ama), 'Free');
});

test('a real payment starts the plan once, however many times it is reported', async () => {
  const r = await start(ama, 1);
  verdicts[r.reference] = { status: 'success', amount: 7500, currency: 'GHS' };
  const evt = { event: 'charge.success', data: { reference: r.reference } };
  assert.equal((await webhook(evt)).status, 200);
  assert.equal(await planOf(ama), 'Plus');
  const exp1 = db.prepare('SELECT plan_exp e FROM users WHERE id=?').get(ama.user.id).e;
  assert.ok(Math.abs(exp1 - (Date.now() + 30 * 864e5)) < 60000);

  await webhook(evt); await webhook(evt);
  const v = await call('POST', '/premium/paystack/verify', { token: ama.token, body: { reference: r.reference } });
  assert.equal(v.body.status, 'success'); assert.equal(v.body.plan, 'Plus');
  assert.equal(v.body.amountMinor, 7500); assert.equal(v.body.currency, 'GHS'); assert.equal(v.body.reference, r.reference); assert.ok(v.body.planExpiresAt > Date.now()); // what the receipt screen shows
  const hist = (await call('GET', '/premium', { token: ama.token })).body.payments;
  assert.ok(hist.some((p) => p.status === 'success' && p.amountMinor === 7500));
  assert.equal(db.prepare('SELECT plan_exp e FROM users WHERE id=?').get(ama.user.id).e, exp1); // not extended by repeats
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id=? AND message LIKE 'Your Plus plan is active%'").get(ama.user.id).c, 1);
  assert.equal(db.prepare('SELECT channel FROM payments WHERE reference=?').get(r.reference).channel, 'mobile_money');
});

test('people cannot verify, or claim, someone else\'s payment', async () => {
  const ref = db.prepare("SELECT reference FROM payments WHERE status='success'").get().reference;
  assert.equal((await call('POST', '/premium/paystack/verify', { token: kofi.token, body: { reference: ref } })).status, 404);
  assert.equal((await call('POST', '/premium/paystack/verify', { token: kofi.token, body: { reference: 'wtc-nonsense-ref' } })).status, 404);
  assert.equal((await webhook({ event: 'charge.success', data: { reference: 'wtc-unknown-ref0000' } })).status, 200); // ignored, no retry storm
  assert.equal((await webhook('not json')).status, 400);
  assert.equal(await planOf(kofi), 'Free');
});

test('admin sees payments and revenue includes them', async () => {
  const list = await call('GET', '/admin/payments', { token: admin.token });
  const by = (s) => list.body.payments.filter((p) => p.status === s).length;
  assert.equal(by('success'), 1); assert.equal(by('review'), 1); assert.equal(by('abandoned'), 1);
  assert.equal(list.body.needsReview, 1);
  assert.deepEqual(list.body.totals, [{ currency: 'GHS', n: 1, minor: 7500 }]);
  assert.equal((await call('GET', '/admin/payments?status=review', { token: admin.token })).body.payments.length, 1);
  assert.equal((await call('GET', '/admin/payments', { token: ama.token })).status, 403);
  assert.equal((await call('GET', '/admin/economics', { token: admin.token })).body.totals.revenueUsdt, 5);
  assert.equal((await call('GET', `/admin/users/${ama.user.id}`, { token: admin.token })).body.payments.length, 4); // pending, abandoned, review and success
});

test('renewing the same plan adds time, and a lower plan is refused', async () => {
  const before = db.prepare('SELECT plan_exp e FROM users WHERE id=?').get(ama.user.id).e;
  const r = await start(ama, 1);
  verdicts[r.reference] = { status: 'success', amount: 7500, currency: 'GHS' };
  await webhook({ event: 'charge.success', data: { reference: r.reference } });
  const after = db.prepare('SELECT plan_exp e FROM users WHERE id=?').get(ama.user.id).e;
  assert.ok(Math.abs(after - (before + 30 * 864e5)) < 1000);
  db.prepare('UPDATE users SET plan=2, plan_exp=? WHERE id=?').run(Date.now() + 864e5, ama.user.id);
  assert.equal((await call('POST', '/premium/paystack/initialize', { token: ama.token, body: { plan: 1 } })).status, 400);
});
