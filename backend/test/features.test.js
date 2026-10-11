// Tests for owner setup, login security, two-step login, staff roles, the hourly limit and Paystack payments.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAIL = 'boss@test.com';
process.env.ADMIN_SETUP_CODE = 'setup-code-0123456789';
process.env.MAX_ACCOUNTS_PER_IP = '50';
process.env.JWT_SECRET = 'test-secret';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_fake';
process.env.PAYSTACK_FX_RATE = '15';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const cfg = require('../src/config');
const { createApp } = require('../src/server');
const { db } = require('../src/db');
const totp = require('../src/totp');

// ---- a fake Paystack API ----
const verifyReplies = new Map(); // reference -> transaction data returned by /transaction/verify
let paystackMock;
function startMock() {
  return new Promise((resolve) => {
    paystackMock = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        assert.equal(req.headers.authorization, 'Bearer sk_test_fake');
        res.setHeader('content-type', 'application/json');
        if (req.method === 'POST' && req.url === '/transaction/initialize') {
          const b = JSON.parse(body);
          return res.end(JSON.stringify({ status: true, data: { authorization_url: `https://checkout.paystack.test/${b.reference}`, reference: b.reference, access_code: 'x' } }));
        }
        const m = req.url.match(/^\/transaction\/verify\/(.+)$/);
        if (m) return res.end(JSON.stringify({ status: true, data: verifyReplies.get(decodeURIComponent(m[1])) || { reference: m[1], status: 'ongoing' } }));
        res.statusCode = 404; res.end('{}');
      });
    }).listen(0, () => { cfg.paystack.baseUrl = `http://127.0.0.1:${paystackMock.address().port}`; resolve(); });
  });
}

let server, base;
before(async () => {
  await startMock();
  await new Promise((resolve) => { server = createApp().listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; resolve(); }); });
});
after(() => { server.close(); paystackMock.close(); });

async function call(method, path, { token, body, headers = {}, raw } = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const signup = (name, email, extra = {}) => call('POST', '/auth/signup', { body: { name, email, password: 'secret1', ...extra } });
const login = (email, password = 'secret1') => call('POST', '/auth/login', { body: { email, password } });
const step = () => Math.floor(Date.now() / totp.STEP_MS);
const sign = (raw) => crypto.createHmac('sha512', 'sk_test_fake').update(raw).digest('hex');
const webhook = (event) => { const raw = JSON.stringify(event); return call('POST', '/webhooks/paystack', { raw, headers: { 'x-paystack-signature': sign(raw) } }); };

let owner, ama, kofi, ownerSecret;

test('owner can only be claimed with the setup code, once', async () => {
  let r = await signup('Boss', 'boss@test.com');
  assert.equal(r.body.user.role, 'user'); // the email alone is not enough any more
  owner = { id: r.body.user.id, token: r.body.token };

  r = await signup('Ama', 'ama@test.com', { adminSetupCode: 'setup-code-0123456789' });
  assert.equal(r.body.user.role, 'user'); // right code, wrong email
  ama = { id: r.body.user.id, token: r.body.token };

  assert.equal((await call('POST', '/auth/claim-owner', { token: owner.token, body: { setupCode: 'wrong' } })).status, 403);
  assert.equal((await call('POST', '/auth/claim-owner', { token: ama.token, body: { setupCode: 'setup-code-0123456789' } })).status, 403);
  r = await call('POST', '/auth/claim-owner', { token: owner.token, body: { setupCode: 'setup-code-0123456789' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'owner');
  assert.equal((await call('GET', '/me', { token: owner.token })).status, 401); // old 30-day token replaced
  owner.token = r.body.token;
  assert.equal((await call('GET', '/admin/stats', { token: owner.token })).status, 200);

  // Nobody else can claim now, not even with the code and the right email at signup.
  assert.equal((await call('POST', '/auth/claim-owner', { token: owner.token, body: { setupCode: 'setup-code-0123456789' } })).status, 403);
  r = await signup('Kofi', 'kofi@test.com');
  kofi = { id: r.body.user.id, token: r.body.token };
});

test('password change, reset and log out everywhere sign out old logins', async () => {
  const other = (await login('ama@test.com')).body.token;
  let r = await call('POST', '/me/password', { token: ama.token, body: { currentPassword: 'secret1', newPassword: 'secret2' } });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/me', { token: other })).status, 401);
  assert.equal((await call('GET', '/me', { token: ama.token })).status, 401);
  ama.token = r.body.token;
  assert.equal((await call('GET', '/me', { token: ama.token })).status, 200);

  assert.equal((await call('POST', '/me/logout-all', { token: ama.token })).status, 200);
  assert.equal((await call('GET', '/me', { token: ama.token })).status, 401);

  const rec = (await signup('Efua', 'efua@test.com')).body;
  r = await call('POST', '/auth/reset-password', { body: { email: 'efua@test.com', recoveryCode: rec.recoveryCode, newPassword: 'newpass1' } });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/me', { token: rec.token })).status, 401);
  assert.equal((await call('GET', '/me', { token: r.body.token })).status, 200);
  ama.token = (await login('ama@test.com', 'secret2')).body.token;
});

test('two-step login: setup, login, replay, backup codes and lockout', async () => {
  assert.equal((await call('POST', '/me/2fa/setup', { token: owner.token, body: { password: 'nope' } })).status, 401);
  let r = await call('POST', '/me/2fa/setup', { token: owner.token, body: { password: 'secret1' } });
  assert.equal(r.status, 200);
  assert.match(r.body.qr, /^data:image\/png;base64,/);
  assert.match(r.body.otpauthUrl, /^otpauth:\/\/totp\/Watchcoin/);
  ownerSecret = r.body.secret;
  assert.notEqual(db.prepare('SELECT totp_secret s FROM users WHERE id=?').get(owner.id).s, ownerSecret); // stored encrypted

  assert.equal((await call('POST', '/me/2fa/enable', { token: owner.token, body: { code: '000000' } })).status, 401);
  r = await call('POST', '/me/2fa/enable', { token: owner.token, body: { code: totp.codeAt(ownerSecret, step()) } });
  assert.equal(r.status, 200);
  assert.equal(r.body.backupCodes.length, 10);
  const backup = r.body.backupCodes;
  assert.equal((await call('GET', '/me', { token: owner.token })).status, 401); // other sessions signed out
  owner.token = r.body.token;

  r = await login('boss@test.com');
  assert.equal(r.body.twoFactorRequired, true);
  assert.equal(r.body.token, undefined);
  const challenge = r.body.challenge;
  assert.equal((await call('GET', '/me', { token: challenge })).status, 401); // a challenge is not a login
  assert.equal((await call('POST', '/auth/login/2fa', { body: { challenge, code: totp.codeAt(ownerSecret, step()) } })).status, 401); // already used at enable
  const next = totp.codeAt(ownerSecret, step() + 1);
  r = await call('POST', '/auth/login/2fa', { body: { challenge, code: next } });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'owner');
  assert.equal((await call('POST', '/auth/login/2fa', { body: { challenge, code: next } })).status, 401); // replay

  r = await call('POST', '/auth/login/2fa', { body: { challenge, code: backup[0] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.backupCodesLeft, 9);
  assert.equal((await call('POST', '/auth/login/2fa', { body: { challenge, code: backup[0] } })).status, 401); // one use only
  owner.token = r.body.token;

  // One wrong code was already counted above (the reused backup code), so four more lock the account.
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/auth/login/2fa', { body: { challenge, code: '123456' } })).status, 401);
  assert.equal((await call('POST', '/auth/login/2fa', { body: { challenge, code: '123457' } })).status, 401);
  assert.equal((await call('POST', '/auth/login/2fa', { body: { challenge, code: backup[1] } })).status, 429); // locked
  db.prepare('UPDATE users SET mfa_locked_until=0 WHERE id=?').run(owner.id);

  const audit = (await call('GET', '/admin/audit', { token: owner.token })).body.entries.map((e) => e.action);
  for (const a of ['owner.claim', 'auth.2fa_on', 'auth.login', 'auth.login_backup_code']) assert.ok(audit.includes(a), `audit missing ${a}`);
});

test('staff must turn on two-step login when it is required', async () => {
  cfg.require2fa = true;
  try {
    assert.equal((await call('GET', '/admin/stats', { token: owner.token })).status, 200); // owner has it on
    assert.equal((await call('POST', `/admin/users/${kofi.id}/role`, { token: owner.token, body: { role: 'support' } })).status, 200);
    kofi.token = (await login('kofi@test.com')).body.token;
    const r = await call('GET', '/admin/stats', { token: kofi.token });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, '2fa_required');
    assert.equal((await call('GET', '/me/2fa', { token: kofi.token })).body.requiredForAdmin, true);
  } finally { cfg.require2fa = false; }
});

test('roles: support reads, admin manages, owner controls money and staff', async () => {
  const as = (tok) => (m, p, body) => call(m, p, { token: tok, body });
  const support = as(kofi.token);
  assert.equal((await support('GET', '/admin/users')).status, 200);
  assert.equal((await support('GET', `/admin/users/${ama.id}`)).status, 200);
  assert.equal((await support('GET', '/admin/payments')).status, 200);
  assert.equal((await support('POST', '/admin/tasks', { type: 'poll', title: 'x', tokens: 1, question: 'q', options: ['a', 'b'] })).status, 403);
  assert.equal((await support('POST', `/admin/users/${ama.id}/ban`, { banned: true })).status, 403);
  assert.equal((await support('GET', '/admin/audit')).status, 403);
  assert.equal((await support('POST', `/admin/users/${ama.id}/role`, { role: 'admin' })).status, 403);

  const O = as(owner.token);
  assert.equal((await O('POST', `/admin/users/${kofi.id}/role`, { role: 'admin' })).status, 200);
  assert.equal((await support('GET', '/admin/users')).status, 401); // role change signs them out
  kofi.token = (await login('kofi@test.com')).body.token;
  const admin = as(kofi.token);
  assert.equal((await admin('GET', '/admin/audit')).status, 200);
  assert.equal((await admin('POST', `/admin/users/${ama.id}/adjust`, { amount: 10, note: 'test refund' })).status, 403);
  assert.equal((await admin('PUT', '/admin/settings', { tokenPrice: 1 })).status, 403);
  assert.equal((await fetch(`${base}/admin/export/users.csv`, { headers: { authorization: `Bearer ${kofi.token}` } })).status, 403);
  assert.equal((await admin('POST', `/admin/users/${owner.id}/logout`)).status, 403); // can't sign out a higher role
  assert.equal((await admin('POST', `/admin/users/${ama.id}/logout`)).status, 200);
  assert.equal((await call('GET', '/me', { token: ama.token })).status, 401);
  ama.token = (await login('ama@test.com', 'secret2')).body.token;

  assert.equal((await O('POST', `/admin/users/${kofi.id}/ban`, { banned: true })).status, 400); // staff can't be banned
  assert.equal((await O('POST', `/admin/users/${owner.id}/role`, { role: 'user' })).status, 400);
  assert.equal((await O('POST', `/admin/users/${ama.id}/adjust`, { amount: 10, note: 'test refund' })).status, 200);
  const staff = (await O('GET', '/admin/staff')).body.staff;
  assert.deepEqual(staff.map((s) => s.role).sort(), ['admin', 'owner']);

  // Banning signs the user out everywhere.
  const t = (await login('efua@test.com', 'newpass1')).body.token;
  await O('POST', `/admin/users/${db.prepare("SELECT id FROM users WHERE email='efua@test.com'").get().id}/ban`, { banned: true });
  assert.equal((await call('GET', '/me', { token: t })).status, 401);
  assert.equal((await call('DELETE', '/me', { token: kofi.token, body: { password: 'secret1' } })).status, 403); // staff can't self-delete
});

test('the hourly limit is also checked when a task is finished', async () => {
  db.prepare('UPDATE users SET plan=3, plan_exp=? WHERE id=?').run(Date.now() + 86400000, ama.id);
  const ids = db.prepare("SELECT id FROM tasks WHERE active=1 AND type!='poll' ORDER BY position LIMIT 6").all().map((r) => r.id);
  for (const id of ids) assert.equal((await call('POST', `/tasks/${id}/start`, { token: ama.token })).status, 200); // all started at once
  db.prepare('UPDATE sessions SET started_at = started_at - 600000 WHERE user_id=?').run(ama.id);
  const codes = [];
  for (const id of ids) codes.push((await call('POST', `/tasks/${id}/complete`, { token: ama.token, body: { answer: 0 } })).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
  db.prepare('UPDATE users SET plan=0, plan_exp=0 WHERE id=?').run(ama.id);
});

test('paystack: checkout, signed webhook, idempotency, wrong amount and verify', async () => {
  let p = await call('GET', '/premium', { token: ama.token });
  assert.equal(p.body.onlinePayment.enabled, true);
  assert.equal(p.body.onlinePayment.currency, 'GHS');
  assert.deepEqual(p.body.onlinePayment.prices.map((x) => x.amount), [75, 225, 450]); // 5, 15, 30 USDT at 15 GHS

  let r = await call('POST', '/premium/checkout', { token: ama.token, body: { plan: 1 } });
  assert.equal(r.status, 201);
  assert.match(r.body.authorizationUrl, /^https:\/\/checkout\.paystack\.test\/wc_/);
  const ref1 = r.body.reference;
  assert.equal(db.prepare('SELECT amount FROM payments WHERE reference=?').get(ref1).amount, 7500);

  const tx = { reference: ref1, status: 'success', amount: 7500, currency: 'GHS' };
  // Unsigned or forged webhooks are refused.
  assert.equal((await call('POST', '/webhooks/paystack', { body: { event: 'charge.success', data: tx } })).status, 401);
  assert.equal((await call('POST', '/webhooks/paystack', { body: { event: 'charge.success', data: tx }, headers: { 'x-paystack-signature': 'ab'.repeat(64) } })).status, 401);
  assert.equal((await call('GET', '/me', { token: ama.token })).body.user.plan.id, 0);

  assert.equal((await webhook({ event: 'charge.success', data: tx })).status, 200);
  const me = (await call('GET', '/me', { token: ama.token })).body.user;
  assert.equal(me.plan.name, 'Plus');
  const exp = me.plan.expiresAt;
  await webhook({ event: 'charge.success', data: tx }); // Paystack retries: nothing changes
  assert.equal((await call('GET', '/me', { token: ama.token })).body.user.plan.expiresAt, exp);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM upgrades WHERE source='paystack'").get().c, 1);

  // Moving up to Pro keeps the value of the unused Plus days (a third, since Pro costs 3x).
  const ref2 = (await call('POST', '/premium/checkout', { token: ama.token, body: { plan: 2 } })).body.reference;
  await webhook({ event: 'charge.success', data: { reference: ref2, status: 'success', amount: 22500, currency: 'GHS' } });
  const pro = (await call('GET', '/me', { token: ama.token })).body.user.plan;
  assert.equal(pro.name, 'Pro');
  const expected = Date.now() + (exp - Date.now()) / 3 + 30 * 86400000;
  assert.ok(Math.abs(pro.expiresAt - expected) < 5000, 'unused days carried over');
  assert.equal((await call('POST', '/premium/checkout', { token: ama.token, body: { plan: 1 } })).status, 400); // no downgrade

  // A payment for the wrong amount goes to review instead of switching the plan on.
  const k = (await login('kofi@test.com')).body.token;
  const ref3 = (await call('POST', '/premium/checkout', { token: k, body: { plan: 3 } })).body.reference;
  await webhook({ event: 'charge.success', data: { reference: ref3, status: 'success', amount: 100, currency: 'GHS' } });
  assert.equal(db.prepare('SELECT status FROM payments WHERE reference=?').get(ref3).status, 'review');
  assert.equal((await call('GET', '/me', { token: k })).body.user.plan.id, 0);
  const pay3 = db.prepare('SELECT id FROM payments WHERE reference=?').get(ref3).id;
  assert.equal((await call('POST', `/admin/payments/${pay3}/approve`, { token: owner.token })).status, 200);
  assert.equal((await call('GET', '/me', { token: k })).body.user.plan.name, 'VIP');

  // The app checks when the user comes back, even if the webhook has not arrived.
  const efuaLike = (await signup('Yaw', 'yaw@test.com')).body.token;
  const ref4 = (await call('POST', '/premium/checkout', { token: efuaLike, body: { plan: 1 } })).body.reference;
  assert.equal((await call('GET', `/premium/checkout/${ref4}`, { token: efuaLike })).body.status, 'pending');
  verifyReplies.set(ref4, { reference: ref4, status: 'success', amount: 7500, currency: 'GHS' });
  r = await call('GET', `/premium/checkout/${ref4}`, { token: efuaLike });
  assert.equal(r.body.status, 'success');
  assert.equal(r.body.user.plan.name, 'Plus');
  assert.equal((await call('GET', `/premium/checkout/${ref4}`, { token: ama.token })).status, 404); // not hers

  const list = (await call('GET', '/admin/payments?status=success', { token: owner.token })).body.payments;
  assert.equal(list.length, 4);
  const eco = (await call('GET', '/admin/economics', { token: owner.token })).body;
  assert.equal(eco.totals.revenueUsdt, 5 + 15 + 30 + 5);

  // The owner can change the exchange rate; prices follow.
  await call('PUT', '/admin/settings', { token: owner.token, body: { fxRate: 16 } });
  p = await call('GET', '/premium', { token: ama.token });
  assert.equal(p.body.onlinePayment.prices[0].amount, 80);
});

test('sign-up saves country and language; translations are complete', async () => {
  let r = await signup('Koffi', 'koffi@test.tg', { country: 'tg', lang: 'fr' });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.country, 'TG');
  assert.equal(r.body.user.lang, 'fr');
  assert.equal((await signup('Bad', 'bad@test.com', { country: 'Togo' })).status, 400);
  assert.equal((await signup('Bad', 'bad2@test.com', { lang: 'de' })).status, 400);
  const tok = r.body.token;
  for (const l of ['es', 'zh', 'sw', 'ha', 'tw', 'en']) assert.equal((await call('PATCH', '/me', { token: tok, body: { lang: l } })).body.user.lang, l);
  assert.equal((await call('PATCH', '/me', { token: tok, body: { country: 'KE' } })).body.user.country, 'KE');

  // Every language has every text, with the same {placeholders} as English.
  const { check, LANGS } = require('../scripts/build-i18n');
  const strings = Object.fromEntries(LANGS.map(([c]) => [c, require(`../i18n/${c}.json`)]));
  assert.deepEqual(check(strings), []);
  // Every message the server can send to a user has a translation entry.
  const fs = require('fs'), path = require('path');
  const src = ['routes/auth.js', 'routes/play.js', 'routes/premium.js', 'routes/user.js', 'middleware.js', 'mfa.js', 'paystack.js']
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n');
  const msgs = [...src.matchAll(/HttpError\(\d+, (['"])(.+?)\1/g)].map((m) => m[2]).filter((m) => !/staff|Staff|admin|Admin|two-step|Two-step|setup|owner|ADMIN|Start setup|not a payment/.test(m));
  const missing = msgs.filter((m) => !(m in strings.en.srv) && !Object.keys(strings.en.srv).some((k) => k.includes('{') && new RegExp('^' + k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{\w+\\?\}/g, '.+') + '$').test(m.replace(/\$\{[^}]+\}/g, 'X'))));
  assert.deepEqual(missing, []);
});
