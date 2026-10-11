// Changing DATA_KEY used to make every two-step login crash with "Something went wrong".
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.MAX_ACCOUNTS_PER_IP = '50';
process.env.JWT_SECRET = 'test-secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cfg = require('../src/config');
const totp = require('../src/totp');
const { createApp } = require('../src/server');

let server, base;
before(() => new Promise((resolve) => {
  server = createApp().listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; resolve(); });
}));
after(() => server.close());

async function call(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const nowStep = () => Math.floor(Date.now() / totp.STEP_MS);

// Creates an account with two-step login on, using the current DATA_KEY.
async function accountWith2fa(email) {
  const s = await call('POST', '/auth/signup', { body: { name: 'T', email, password: 'goodpass123' } });
  const setup = await call('POST', '/me/2fa/setup', { token: s.body.token, body: { password: 'goodpass123' } });
  const en = await call('POST', '/me/2fa/enable', { token: s.body.token, body: { code: totp.codeAt(setup.body.secret, nowStep()) } });
  assert.equal(en.status, 200);
  return { email, secret: setup.body.secret, backup: en.body.backupCodes };
}
async function secondStep(email, code) {
  const l = await call('POST', '/auth/login', { body: { email, password: 'goodpass123' } });
  assert.equal(l.body.twoFactorRequired, true);
  return call('POST', '/auth/login/2fa', { body: { challenge: l.body.challenge, code } });
}

test('after DATA_KEY changes: clear message (not a crash), backup codes still work, old key restores everything', async () => {
  const keyA = cfg.dataKey, keyB = 'a-completely-different-key-for-the-test-1234567890';
  const acc = await accountWith2fa('keychange@test.com');
  try {
    cfg.dataKey = keyB; // the owner changed DATA_KEY in Railway

    let r = await secondStep(acc.email, totp.codeAt(acc.secret, nowStep() + 1));
    assert.equal(r.status, 409);
    assert.equal(r.body.code, '2fa_unreadable');
    assert.match(r.body.error, /backup code/i);

    r = await secondStep(acc.email, acc.backup[0]); // backup codes do not need the secret
    assert.equal(r.status, 200);
    assert.ok(r.body.token);

    cfg.previousDataKeys = [keyA]; // DATA_KEY_PREVIOUS set to the old key
    r = await secondStep(acc.email, totp.codeAt(acc.secret, nowStep() + 1));
    assert.equal(r.status, 200);
    const row = require('../src/db').db.prepare('SELECT totp_secret FROM users WHERE email=?').get(acc.email);
    assert.ok(totp.isCurrent(row.totp_secret), 'the secret is saved again with the new key');

    cfg.previousDataKeys = []; // the old key is no longer needed: the re-saved secret opens with the new key alone
    assert.equal(totp.open(row.totp_secret), acc.secret);
  } finally { cfg.dataKey = keyA; cfg.previousDataKeys = []; }
});

test('a wrong code is still just "not right" while the secret is readable', async () => {
  const acc = await accountWith2fa('wrongcode@test.com');
  const r = await secondStep(acc.email, '000000');
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'That code is not right');
});

test('npm run reset-2fa switches two-step login off for one account', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-reset-')), dbFile = path.join(dir, 't.db');
  const env = { PATH: process.env.PATH, NODE_ENV: 'test', DB_PATH: dbFile, JWT_SECRET: 'test-secret' };
  const run = (args) => spawnSync(process.execPath, args, { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
  const seed = `const {db}=require('./src/db');
    db.prepare("INSERT INTO users(email,name,pass_hash,recovery_hash,role,ref_code,created_at,totp_enabled,totp_secret,backup_codes) VALUES ('boss@x.com','B','h','h','owner','AAAAAA',1,1,'v1.x.y.z','[\\"abc\\"]')").run();`;
  assert.equal(run(['-e', seed]).status, 0);
  assert.notEqual(run(['scripts/reset-2fa.js', 'nobody@x.com']).status, 0);
  const out = run(['scripts/reset-2fa.js', 'Boss@X.com']);
  assert.equal(out.status, 0, out.stderr);
  const check = run(['-e', "const {db}=require('./src/db');console.log(JSON.stringify(db.prepare(\"SELECT totp_enabled,totp_secret,backup_codes,token_version FROM users\").get()))"]);
  assert.deepEqual(JSON.parse(check.stdout.trim()), { totp_enabled: 0, totp_secret: null, backup_codes: '[]', token_version: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
});
