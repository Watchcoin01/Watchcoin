// The owner can set the price of each premium plan.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.MAX_ACCOUNTS_PER_IP = '50';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_EMAIL = 'boss@test.com';
process.env.ADMIN_SETUP_CODE = 'setup-code-for-tests';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const paystack = require('../src/paystack');

let server, base, boss;
before(async () => {
  await new Promise((resolve) => { server = createApp().listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; resolve(); }); });
  boss = (await call('POST', '/auth/signup', { body: { name: 'Boss', email: 'boss@test.com', password: 'bosspass123', adminSetupCode: 'setup-code-for-tests' } })).body;
});
after(() => server.close());

async function call(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const setPrices = (planPrices, token = boss.token) => call('PUT', '/admin/settings', { token, body: { planPrices } });
const newUser = async (email) => (await call('POST', '/auth/signup', { body: { name: 'U', email, password: 'userpass123' } })).body;

test('starting prices are 5, 15 and 30 until the owner changes them', async () => {
  const s = await call('GET', '/admin/settings', { token: boss.token });
  assert.deepEqual(s.body.plans.map((p) => p.priceUsdt), [5, 15, 30]);
  assert.deepEqual(s.body.plans.map((p) => p.defaultUsdt), [5, 15, 30]);
});

test('invalid prices are refused and nothing changes', async () => {
  const bad = [
    [{ 1: 10, 2: 10, 3: 30 }, /more than the one below/],
    [{ 1: 30, 2: 15, 3: 5 }, /more than the one below/],
    [{ 1: 0.5, 2: 15, 3: 30 }, /between 1 and 1000/],
    [{ 1: 5, 2: 15, 3: 1001 }, /between 1 and 1000/],
    [{ 1: -5, 2: 15, 3: 30 }, /between 1 and 1000/],
    [{ 1: 5.555, 2: 15, 3: 30 }, /2 decimal/],
  ];
  for (const [prices, msg] of bad) {
    const r = await setPrices(prices);
    assert.equal(r.status, 400, JSON.stringify(prices));
    assert.match(r.body.error, msg);
  }
  assert.equal((await call('PUT', '/admin/settings', { token: boss.token, body: { planPrices: { 1: 6, 2: 16 } } })).status, 400); // all three are needed
  assert.equal((await call('PUT', '/admin/settings', { token: boss.token, body: { planPrices: { 1: '6', 2: 16, 3: 31 } } })).status, 400); // numbers only
  const s = await call('GET', '/admin/settings', { token: boss.token });
  assert.deepEqual(s.body.plans.map((p) => p.priceUsdt), [5, 15, 30]);
});

test('only the owner can change prices', async () => {
  const u = await newUser('plain@test.com');
  assert.equal((await setPrices({ 1: 6, 2: 16, 3: 31 }, u.token)).status, 403);
});

test('a new price shows to users, in online payment amounts, and in the audit log', async () => {
  await call('PUT', '/admin/settings', { token: boss.token, body: { fxRate: 15 } });
  const r = await setPrices({ 1: 7.5, 2: 20, 3: 45 });
  assert.equal(r.status, 200);

  const u = await newUser('buyer@test.com');
  const prem = await call('GET', '/premium', { token: u.token });
  assert.deepEqual(prem.body.plans.map((p) => p.priceUsdt), [0, 7.5, 20, 45]);
  assert.equal(paystack.priceMinor(1), 7.5 * 15 * 100); // what Paystack would charge, in pesewas

  const audit = await call('GET', '/admin/audit', { token: boss.token });
  const entry = audit.body.entries.find((e) => /planPrices/.test(e.detail));
  assert.ok(entry, 'the change is written to the audit log');
  assert.match(entry.detail, /Plus 5->7\.5/);
});

test('a price change never rewrites what an earlier sale cost', async () => {
  await setPrices({ 1: 5, 2: 15, 3: 30 });
  const u = await newUser('early@test.com');
  const req = await call('POST', '/premium/upgrade', { token: u.token, body: { plan: 1, reference: 'ref-early-1' } });
  assert.equal(req.status, 201, JSON.stringify(req.body));

  await setPrices({ 1: 8, 2: 15, 3: 30 }); // price goes up after the user asked, before the owner approves

  const list = await call('GET', '/admin/upgrades?status=pending', { token: boss.token });
  const row = list.body.upgrades.find((g) => g.reference === 'ref-early-1');
  assert.equal(row.priceUsdt, 5, 'the owner sees the price the user was shown');

  assert.equal((await call('POST', `/admin/upgrades/${row.id}/decide`, { token: boss.token, body: { approve: true } })).status, 200);
  const eco = await call('GET', '/admin/economics?days=1', { token: boss.token });
  assert.equal(eco.body.totals.revenueUsdt, 5);
});
