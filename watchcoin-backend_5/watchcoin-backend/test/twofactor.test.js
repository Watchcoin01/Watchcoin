process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.MAX_ACCOUNTS_PER_IP = '50';
process.env.JWT_SECRET = 'test-secret';
process.env.REQUIRE_STAFF_2FA = 'true';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { db } = require('../src/db');
const totp = require('../src/totp');

let server, base;
before(() => new Promise((resolve) => { server = createApp().listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; resolve(); }); }));
after(() => server.close());
async function call(method, p, { token, body } = {}) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; } return { status: res.status, body: json };
}
const signup = async (n, e) => (await call('POST', '/auth/signup', { body: { name: n, email: e, password: 'secret1' } })).body;
const login = (email) => call('POST', '/auth/login', { body: { email, password: 'secret1' } });
const next = (secret) => totp.code(secret, Date.now() + 30000); // the next 30-second code (accepted, and newer than any used so far)
const SECRET20 = totp.b32encode(Buffer.from('12345678901234567890'));
let admin, ama, kofi, adminSecret, recovery;

// Gets a staff member through setup. Returns their secret and recovery codes.
async function enroll(u) {
  const s = (await call('POST', '/me/2fa/setup', { token: u.token })).body;
  const r = await call('POST', '/me/2fa/enable', { token: u.token, body: { code: totp.code(s.secret) } });
  return { secret: s.secret, codes: r.body.recoveryCodes };
}

test('the code generator matches the official RFC 6238 test values', () => {
  for (const [t, want] of [[59, '287082'], [1111111109, '081804'], [1234567890, '005924'], [2000000000, '279037']]) assert.equal(totp.code(SECRET20, t * 1000), want);
  assert.equal(totp.verify(SECRET20, '287082', 59000) > 0, true);
  assert.equal(totp.verify(SECRET20, '287082', 59000 + 90000), 0); // too old
  assert.equal(totp.verify(SECRET20, 'abcdef', 59000), 0);
});

test('staff cannot use the admin tools until two-step login is on', async () => {
  admin = await signup('Boss', 'admin@test.com'); ama = await signup('Ama', 'ama@test.com'); kofi = await signup('Kofi', 'kofi@test.com');
  assert.equal(admin.user.twoFactor.required, true); assert.equal(admin.user.twoFactor.enabled, false);
  const r = await call('GET', '/admin/stats', { token: admin.token });
  assert.equal(r.status, 403); assert.equal(r.body.setup2fa, true);
  assert.equal((await call('GET', '/me', { token: admin.token })).status, 200); // the setup screens still work
  assert.equal((await call('POST', '/me/2fa/setup', { token: kofi.token })).status, 403); // normal users do not get this
});

test('setting up: the code must be right, and recovery codes are given once', async () => {
  const s = (await call('POST', '/me/2fa/setup', { token: admin.token })).body;
  adminSecret = s.secret;
  assert.match(s.secret, /^[A-Z2-7]{32}$/); assert.match(s.uri, /^otpauth:\/\/totp\/Watchcoin:admin%40test\.com\?secret=/);
  assert.equal((await call('POST', '/me/2fa/enable', { token: admin.token, body: { code: '000000' } })).status, 400);
  const ok = await call('POST', '/me/2fa/enable', { token: admin.token, body: { code: totp.code(adminSecret) } });
  assert.equal(ok.status, 200); assert.equal(ok.body.recoveryCodes.length, 10); assert.match(ok.body.recoveryCodes[0], /^[a-z0-9]{5}-[a-z0-9]{5}$/);
  recovery = ok.body.recoveryCodes;
  assert.equal(db.prepare('SELECT COUNT(*) c FROM recovery_codes').get().c, 10);
  assert.ok(!db.prepare('SELECT code_hash FROM recovery_codes').all().some((r) => recovery.includes(r.code_hash))); // only hashes are stored
  assert.equal((await call('GET', '/admin/stats', { token: admin.token })).status, 200); // now allowed
  assert.equal((await call('POST', '/me/2fa/setup', { token: admin.token })).status, 409);
});

test('signing in needs the second step, and a half-finished sign-in is not a session', async () => {
  const r = (await login('admin@test.com')).body;
  assert.equal(r.twoFactorRequired, true); assert.equal(r.token, undefined);
  assert.equal((await call('GET', '/me', { token: r.challenge })).status, 401); // the challenge cannot be used as a login
  assert.equal((await call('POST', '/auth/login/2fa', { body: { challenge: r.challenge, code: '123456' } })).status, 401);
  assert.equal((await call('POST', '/auth/login/2fa', { body: { challenge: 'garbage', code: '123456' } })).status, 401);
  const ok = await call('POST', '/auth/login/2fa', { body: { challenge: r.challenge, code: next(adminSecret) } });
  assert.equal(ok.status, 200); assert.ok(ok.body.token);
  assert.equal((await call('GET', '/admin/stats', { token: ok.body.token })).status, 200);
});

test('a code works only once', async () => {
  db.prepare('UPDATE users SET totp_last_step=0').run();
  const code = next(adminSecret);
  assert.equal((await call('POST', '/auth/login/2fa', { body: { challenge: (await login('admin@test.com')).body.challenge, code } })).status, 200);
  assert.equal((await call('POST', '/auth/login/2fa', { body: { challenge: (await login('admin@test.com')).body.challenge, code } })).status, 401); // someone who saw it cannot reuse it
});

test('recovery codes work once each', async () => {
  const c = recovery[0];
  const ch = () => login('admin@test.com').then((r) => r.body.challenge);
  assert.equal((await call('POST', '/auth/login/2fa', { body: { challenge: await ch(), code: c.toUpperCase() } })).status, 200); // case does not matter
  assert.equal((await call('POST', '/auth/login/2fa', { body: { challenge: await ch(), code: c } })).status, 401);
  assert.equal((await call('GET', '/me/2fa', { token: admin.token })).body.recoveryCodesLeft, 9);
});

test('guessing is stopped after five wrong codes', async () => {
  const ch = (await login('admin@test.com')).body.challenge;
  // wrong codes from the earlier tests count too, so it can stop sooner than the fifth try here
  let stoppedAt = 0;
  for (let i = 1; i <= 6 && !stoppedAt; i++) {
    const r = await call('POST', '/auth/login/2fa', { body: { challenge: ch, code: '000000' } });
    if (r.status === 429) stoppedAt = i; else assert.equal(r.status, 401);
  }
  assert.ok(stoppedAt >= 1 && stoppedAt <= 6);
  db.prepare('UPDATE users SET totp_last_step=0').run();
  assert.equal((await call('POST', '/auth/login/2fa', { body: { challenge: ch, code: next(adminSecret) } })).status, 429); // even the right code is refused for a while
});

test('staff cannot switch two-step login off while it is required, and need password and code to change recovery codes', async () => {
  assert.equal((await call('POST', '/me/2fa/disable', { token: admin.token, body: { password: 'secret1', code: recovery[1] } })).status, 403);
  db.prepare('UPDATE users SET totp_last_step=0').run();
  assert.equal((await call('POST', '/me/2fa/recovery-codes', { token: admin.token, body: { password: 'wrong-password', code: next(adminSecret) } })).status, 401);
  const fresh = await call('POST', '/me/2fa/recovery-codes', { token: admin.token, body: { password: 'secret1', code: recovery[2] } });
  assert.equal(fresh.status, 200); assert.equal(fresh.body.recoveryCodes.length, 10);
  assert.equal((await call('GET', '/me/2fa', { token: admin.token })).body.recoveryCodesLeft, 10); // the old ones are gone
});

test('the admin can add a support person, and support can look things up but not move money', async () => {
  const A = (m, p, body) => call(m, p, { token: admin.token, body });
  assert.equal((await A('POST', '/admin/staff', { email: 'nobody@test.com', role: 'support' })).status, 404);
  assert.equal((await A('POST', '/admin/staff', { email: 'admin@test.com', role: 'user' })).status, 400); // the admin cannot be demoted here
  assert.equal((await A('POST', '/admin/staff', { email: 'ama@test.com', role: 'support' })).status, 200);
  assert.equal((await call('GET', '/admin/users', { token: ama.token })).status, 403); // still needs her own two-step login
  const mine = await enroll(ama);
  const S = (m, p, body) => call(m, p, { token: ama.token, body });

  for (const p of ['/admin/users', `/admin/users/${kofi.user.id}`, `/admin/users/${kofi.user.id}/ledger`, '/admin/tickets', '/admin/payments', '/admin/crypto-orders', '/admin/upgrades', '/admin/fraud', '/admin/schedule', '/admin/tasks', '/admin/tasks/stats']) {
    assert.equal((await S('GET', p)).status, 200, `support should read ${p}`);
  }
  await call('POST', '/support', { token: kofi.token, body: { message: 'I did not get my tokens' } });
  const t = (await S('GET', '/admin/tickets')).body.tickets[0];
  assert.equal((await S('POST', `/admin/tickets/${t.id}/resolve`)).status, 200);

  for (const [m, p, body] of [
    ['POST', `/admin/users/${kofi.user.id}/adjust`, { amount: 100, note: 'free money' }], ['POST', `/admin/users/${kofi.user.id}/ban`, { banned: true }],
    ['PUT', '/admin/settings', { tokenPrice: 1 }], ['GET', '/admin/settings'], ['GET', '/admin/stats'], ['GET', '/admin/economics'], ['GET', '/admin/backups'], ['POST', '/admin/backups/run'],
    ['GET', '/admin/audit'], ['GET', '/admin/staff'], ['POST', '/admin/staff', { email: 'kofi@test.com', role: 'support' }], ['POST', '/admin/upgrades/1/decide', { approve: true }],
    ['POST', '/admin/tasks', { type: 'like', title: 'x', url: 'https://youtu.be/a', tokens: 5, secs: 10 }], ['DELETE', '/admin/tasks/1'], ['POST', '/admin/broadcasts', { message: 'hello all', audience: 'all' }],
  ]) assert.equal((await S(m, p, body)).status, 403, `support must not ${m} ${p}`);
  assert.equal((await call('GET', '/admin/users', { token: kofi.token })).status, 403); // an ordinary user gets nothing

  // admin can reset her phone if she loses it, and can remove her
  assert.equal((await A('POST', `/admin/staff/${ama.user.id}/reset-2fa`)).status, 200);
  assert.equal((await S('GET', '/admin/users')).status, 403); // must set it up again
  assert.equal((await A('POST', '/admin/staff', { email: 'ama@test.com', role: 'user' })).status, 200);
  assert.equal((await S('GET', '/admin/tickets')).status, 403);
  const audit = (await A('GET', '/admin/audit')).body.entries.map((e) => e.action);
  for (const a of ['staff.add', 'staff.reset2fa', 'staff.remove']) assert.ok(audit.includes(a));
  assert.ok(mine.secret);
});
