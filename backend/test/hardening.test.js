process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.MAX_ACCOUNTS_PER_IP = '50';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_EMAIL = 'boss@test.com';
process.env.ADMIN_SETUP_CODE = 'setup-code-for-tests';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/server');
const attempts = require('../src/attempts');
const { csvCell } = require('../src/util');

let server, base;
before(() => new Promise((resolve) => {
  server = createApp().listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; resolve(); });
}));
after(() => server.close());
beforeEach(() => { attempts.login.reset(); attempts.reset.reset(); });

async function call(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const signup = (email, password = 'goodpass1') => call('POST', '/auth/signup', { body: { name: 'T', email, password } });

test('passwords shorter than 8 or longer than 72 characters are refused', async () => {
  assert.equal((await signup('short@test.com', 'abc1234')).status, 400);
  assert.equal((await signup('long@test.com', 'a'.repeat(73))).status, 400);
  assert.equal((await signup('ok@test.com', 'abcd1234')).status, 201);
});

test('login locks one account after 10 wrong passwords, even if the right one follows', async () => {
  await signup('lock@test.com');
  for (let i = 0; i < 10; i++) {
    assert.equal((await call('POST', '/auth/login', { body: { email: 'lock@test.com', password: 'wrongpass' } })).status, 401);
  }
  const locked = await call('POST', '/auth/login', { body: { email: 'lock@test.com', password: 'goodpass1' } });
  assert.equal(locked.status, 429);
  // Another account is not affected.
  await signup('other@test.com');
  assert.equal((await call('POST', '/auth/login', { body: { email: 'other@test.com', password: 'goodpass1' } })).status, 200);
});

test('a correct login clears the failure count', async () => {
  await signup('clear@test.com');
  for (let i = 0; i < 9; i++) await call('POST', '/auth/login', { body: { email: 'clear@test.com', password: 'wrongpass' } });
  assert.equal((await call('POST', '/auth/login', { body: { email: 'clear@test.com', password: 'goodpass1' } })).status, 200);
  for (let i = 0; i < 9; i++) await call('POST', '/auth/login', { body: { email: 'clear@test.com', password: 'wrongpass' } });
  assert.equal((await call('POST', '/auth/login', { body: { email: 'clear@test.com', password: 'goodpass1' } })).status, 200);
});

test('unknown emails are limited the same way, so the limit reveals nothing', async () => {
  for (let i = 0; i < 10; i++) await call('POST', '/auth/login', { body: { email: 'ghost@test.com', password: 'wrongpass' } });
  assert.equal((await call('POST', '/auth/login', { body: { email: 'ghost@test.com', password: 'wrongpass' } })).status, 429);
});

test('recovery-code guessing locks after 5 wrong codes', async () => {
  const r = await signup('rec@test.com');
  for (let i = 0; i < 5; i++) {
    assert.equal((await call('POST', '/auth/reset-password', { body: { email: 'rec@test.com', recoveryCode: 'AAAAAAAA', newPassword: 'newpass123' } })).status, 401);
  }
  const res = await call('POST', '/auth/reset-password', { body: { email: 'rec@test.com', recoveryCode: r.body.recoveryCode, newPassword: 'newpass123' } });
  assert.equal(res.status, 429); // even the right code is refused while locked
});

test('tokens signed with the "none" algorithm or another secret are rejected', async () => {
  const u = (await signup('forge@test.com')).body.user;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: u.id, v: 0, typ: 'access' })}.`;
  assert.equal((await call('GET', '/me', { token: none })).status, 401);
  const wrong = jwt.sign({ sub: u.id, v: 0, typ: 'access' }, 'some-other-secret', { algorithm: 'HS256' });
  assert.equal((await call('GET', '/me', { token: wrong })).status, 401);
  // HS512 with the right secret is also refused: only HS256 is accepted.
  const hs512 = jwt.sign({ sub: u.id, v: 0, typ: 'access' }, 'test-secret', { algorithm: 'HS512' });
  assert.equal((await call('GET', '/me', { token: hs512 })).status, 401);
});

test('task cover images must be PNG, JPEG, WebP or GIF (no SVG)', async () => {
  const boss = (await call('POST', '/auth/signup', { body: { name: 'Boss', email: 'boss@test.com', password: 'bosspass123', adminSetupCode: 'setup-code-for-tests' } })).body;
  assert.equal(boss.user.role, 'owner');
  const task = (cover) => call('POST', '/admin/tasks', { token: boss.token, body: { type: 'poll', title: 'Cover test', tokens: 5, question: 'Pick', options: ['a', 'b'], cover } });
  assert.equal((await task('data:image/svg+xml;base64,PHN2Zy8+')).status, 400);
  assert.equal((await task('data:image/svg+xml,<svg onload=alert(1)>')).status, 400);
  assert.equal((await task('data:text/html;base64,PGgxPg==')).status, 400);
  assert.equal((await task('data:image/jpeg;base64,/9j/4AAQ')).status, 201);
});

test('CSV cells starting with formula characters or a tab are defused', () => {
  for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd']) assert.ok(csvCell(bad).startsWith('"\''), bad);
  assert.equal(csvCell('Ama'), '"Ama"');
});

// Starts config.js in a fresh process, the way the server would on Railway.
const bootConfig = (env) => spawnSync(process.execPath, ['-e', "require('./src/config')"], {
  cwd: path.join(__dirname, '..'), encoding: 'utf8',
  env: { PATH: process.env.PATH, ...env },
});

test('the server refuses to start in production without a strong secret', () => {
  assert.notEqual(bootConfig({ NODE_ENV: 'production' }).status, 0);
  assert.notEqual(bootConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' }).status, 0);
  assert.equal(bootConfig({ NODE_ENV: 'production', JWT_SECRET: crypto.randomBytes(32).toString('hex') }).status, 0);
});

test('Railway counts as production even if NODE_ENV was forgotten', () => {
  const r = bootConfig({ RAILWAY_ENVIRONMENT: 'production' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /JWT_SECRET/);
});
