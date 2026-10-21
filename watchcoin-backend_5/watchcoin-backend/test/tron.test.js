// USDT (TRC20) payment tests run against a fake TronGrid, so no real blockchain or money is needed.
const http = require('http');
const crypto = require('crypto');
const PORT = 46000 + Math.floor(Math.random() * 900);
const WALLET = 'TJmmqjb1DK9TTZbQXzRQ2AuA94z4gKAPFh';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.MAX_ACCOUNTS_PER_IP = '50';
process.env.JWT_SECRET = 'test-secret';
process.env.TRONGRID_BASE_URL = `http://127.0.0.1:${PORT}`;
process.env.TRONGRID_API_KEY = 'key123';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { db } = require('../src/db');
const tron = require('../src/tron');

let transfers = [];
const seen = [];
const fake = http.createServer((req, res) => {
  seen.push({ url: req.url, key: req.headers['tron-pro-api-key'] });
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ data: transfers, success: true }));
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
const planOf = async (u) => (await call('GET', '/me', { token: u.token })).body.user.plan.name;
const order = async (u, plan = 1) => (await call('POST', '/premium/crypto/order', { token: u.token, body: { plan } }));
const hex = () => crypto.randomBytes(32).toString('hex');
// A transfer that pays an order, unless a field is changed.
const pay = (o, over = {}) => ({ transaction_id: hex(), from: 'TFromAddress0000000000000000000000000', to: WALLET, value: String(o.amountMicro), token_info: { address: USDT, decimals: 6, symbol: 'USDT' }, block_timestamp: Date.now() + 1000, type: 'Transfer', ...over });
const status = (o) => db.prepare('SELECT status FROM crypto_orders WHERE id=?').get(o.id).status;

let admin, ama, kofi, yaw, amaOrder, kofiOrder;

test('USDT payments stay off until the admin adds a valid address', async () => {
  admin = await signup('Boss', 'admin@test.com'); ama = await signup('Ama', 'ama@test.com'); kofi = await signup('Kofi', 'kofi@test.com'); yaw = await signup('Yaw', 'yaw@test.com');
  assert.equal((await call('GET', '/premium', { token: ama.token })).body.crypto.auto, false);
  assert.equal((await order(ama)).status, 503);
  assert.equal((await call('PUT', '/admin/settings', { token: admin.token, body: { tronAddress: 'not-an-address' } })).status, 400);
  assert.equal((await call('PUT', '/admin/settings', { token: admin.token, body: { tronAddress: 'T123' } })).status, 400);
  assert.equal((await call('PUT', '/admin/settings', { token: admin.token, body: { tronAddress: WALLET } })).status, 200);
  assert.equal((await call('GET', '/premium', { token: ama.token })).body.crypto.auto, true);
  assert.equal((await call('GET', '/admin/settings', { token: admin.token })).body.crypto.address, WALLET);
});

test('every order gets its own exact amount, close to the plan price', async () => {
  const a = await order(ama), k = await order(kofi);
  amaOrder = a.body.order; kofiOrder = k.body.order;
  assert.equal(a.status, 201);
  assert.equal(amaOrder.address, WALLET); assert.equal(amaOrder.network, 'TRON (TRC20)');
  assert.match(amaOrder.amount, /^5\.00\d\d$/); // 5.0001 to 5.0099
  assert.ok(amaOrder.amountMicro > 5e6 && amaOrder.amountMicro < 5.01e6);
  assert.notEqual(amaOrder.amountMicro, kofiOrder.amountMicro);
  assert.equal((await order(ama)).body.order.id, amaOrder.id); // coming back reuses the same open order
  assert.equal((await order(ama, 0)).status, 400);
  assert.equal((await order(ama, 9)).status, 400);
  const pro = (await order(yaw, 2)).body.order; assert.match(pro.amount, /^15\.00\d\d$/);
  db.prepare('DELETE FROM crypto_orders WHERE id=?').run(pro.id);
});

test('look-alike transfers do not pay an order', async () => {
  const o = amaOrder, k = kofiOrder;
  transfers = [
    pay(o, { value: '5000000' }),                                   // right ballpark, wrong amount
    pay(o, { token_info: { address: 'TFakeToken0000000000000000000000000', decimals: 6, symbol: 'USDT' } }), // a fake USDT
    pay(o, { to: 'TSomeoneElse00000000000000000000000' }),         // sent to a different wallet
    pay(o, { block_timestamp: Date.now() - 600000 }),               // happened before the order existed
    pay(o, { type: 'Approval' }),                                   // not a transfer
    pay(o, { transaction_id: 'not-a-real-hash' }),
    pay({ amountMicro: k.amountMicro + 1 }),                        // one micro-USDT off
  ];
  await tron.scan();
  assert.equal(status(o), 'pending'); assert.equal(status(k), 'pending');
  assert.equal(await planOf(ama), 'Free');
  const last = seen.at(-1);
  assert.match(last.url, new RegExp(`^/v1/accounts/${WALLET}/transactions/trc20`));
  assert.match(last.url, /only_confirmed=true/); assert.match(last.url, new RegExp(`contract_address=${USDT}`)); assert.equal(last.key, 'key123');
});

test('the exact transfer pays only its own order, once', async () => {
  const t = pay(amaOrder, { block_timestamp: Date.now() });
  transfers = [t];
  await tron.scan();
  assert.equal(status(amaOrder), 'paid'); assert.equal(status(kofiOrder), 'pending');
  assert.equal(await planOf(ama), 'Plus'); assert.equal(await planOf(kofi), 'Free');
  assert.equal(db.prepare('SELECT txid FROM crypto_orders WHERE id=?').get(amaOrder.id).txid, t.transaction_id.toLowerCase());
  const exp = db.prepare('SELECT plan_exp e FROM users WHERE id=?').get(ama.user.id).e;
  await tron.scan(); await tron.scan();
  assert.equal(db.prepare('SELECT plan_exp e FROM users WHERE id=?').get(ama.user.id).e, exp);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id=? AND message LIKE 'Your Plus plan is active%'").get(ama.user.id).c, 1);
});

test('an old payment cannot pay a new order, even for the same amount', async () => {
  const renew = (await order(ama)).body.order; // Ama renews
  transfers = [pay(renew, { block_timestamp: Date.now() - 300000 })]; // the same kind of transfer, but from before this order
  await tron.scan();
  assert.equal(status(renew), 'pending');
  db.prepare("UPDATE crypto_orders SET status='expired' WHERE id=?").run(renew.id);
});

test('money that arrives a little late is still honoured, much later is not', async () => {
  const late = (await order(yaw)).body.order;
  db.prepare('UPDATE crypto_orders SET created_at=created_at-7200000, expires_at=? WHERE id=?').run(Date.now() - 3600000, late.id); // expired an hour ago
  transfers = [pay(late, { block_timestamp: Date.now() })];
  await tron.scan();
  assert.equal(status(late), 'paid'); assert.equal(await planOf(yaw), 'Plus');

  const stale = (await order(kofi, 2)).body.order;
  db.prepare('UPDATE crypto_orders SET created_at=created_at-200000000, expires_at=? WHERE id=?').run(Date.now() - 100000000, stale.id); // over a day ago
  transfers = [pay(stale, { block_timestamp: Date.now() - 150000000 })];
  await tron.scan();
  assert.equal(status(stale), 'expired'); assert.equal(await planOf(kofi), 'Free');
});

test('the app can ask about an order, but only its owner, and the chain is not hammered', async () => {
  const k = (await order(kofi)).body.order;
  transfers = [];
  const before = seen.length;
  const r1 = await call('GET', `/premium/crypto/order/${k.id}`, { token: kofi.token });
  const r2 = await call('GET', `/premium/crypto/order/${k.id}`, { token: kofi.token });
  assert.equal(r1.body.order.status, 'pending'); assert.equal(r2.body.order.status, 'pending');
  assert.equal(seen.length - before, 1); // the second question within 8 seconds did not call TronGrid again
  assert.equal((await call('GET', `/premium/crypto/order/${k.id}`, { token: ama.token })).status, 404);
  transfers = [pay(k, { block_timestamp: Date.now() })];
  db.prepare('UPDATE crypto_orders SET last_check=0 WHERE id=?').run(k.id);
  const done = await call('GET', `/premium/crypto/order/${k.id}`, { token: kofi.token });
  assert.equal(done.body.order.status, 'paid'); assert.ok(done.body.order.planExpiresAt > Date.now());
  assert.equal(await planOf(kofi), 'Plus');
});

test('a wrong amount can be sent for review, and an admin approves it', async () => {
  const sam = await signup('Sam', 'sam@test.com');
  const o = (await order(sam)).body.order;
  assert.equal((await call('POST', `/premium/crypto/order/${o.id}/review`, { token: sam.token, body: { txid: 'short' } })).status, 400);
  assert.equal((await call('POST', `/premium/crypto/order/${o.id}/review`, { token: ama.token, body: { txid: hex() } })).status, 404);
  const txid = hex();
  assert.equal((await call('POST', `/premium/crypto/order/${o.id}/review`, { token: sam.token, body: { txid } })).status, 201);
  assert.equal(status(o), 'review');
  assert.equal((await call('POST', `/premium/crypto/order/${o.id}/review`, { token: sam.token, body: { txid } })).status, 404); // no longer open
  const pending = (await call('GET', '/admin/upgrades', { token: admin.token })).body.upgrades;
  assert.equal(pending.length, 1); assert.equal(pending[0].reference, txid);
  await call('POST', `/admin/upgrades/${pending[0].id}/decide`, { token: admin.token, body: { approve: true } });
  assert.equal(await planOf(sam), 'Plus');
});

test('admin sees USDT orders, and revenue includes them', async () => {
  const list = (await call('GET', '/admin/crypto-orders', { token: admin.token })).body;
  assert.equal(list.enabled, true);
  assert.equal(list.paid.n, 3); // Ama, Yaw, Kofi
  assert.ok(list.orders.some((o) => o.status === 'expired') && list.orders.some((o) => o.status === 'review'));
  assert.equal((await call('GET', '/admin/crypto-orders?status=review', { token: admin.token })).body.orders.length, 1);
  assert.equal((await call('GET', '/admin/crypto-orders', { token: ama.token })).status, 403);
  assert.equal((await call('GET', '/admin/economics', { token: admin.token })).body.totals.revenueUsdt, 15 + 5); // 3 USDT plans at 5, plus Sam's approved Plus
});
