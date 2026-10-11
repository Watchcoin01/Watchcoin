process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.MAX_ACCOUNTS_PER_IP = '50';
process.env.JWT_SECRET = 'test-secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { db } = require('../src/db');

let server, base;
before(() => new Promise((resolve) => {
  server = createApp().listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; resolve(); });
}));
after(() => server.close());

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const signup = (name, email, extra = {}) => call('POST', '/auth/signup', { body: { name, email, password: 'secret12', ...extra } });
// Pretend a task was started `ms` ago so tests do not have to wait for real timers.
const backdate = (userId, taskId, ms) => db.prepare('UPDATE sessions SET started_at = started_at - ? WHERE user_id=? AND task_id=?').run(ms, userId, taskId);

let admin, ama, kofi, refCode;

test('signup, login, reset and protected routes', async () => {
  let r = await signup('Boss', 'admin@test.com');
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, 'owner'); // development fallback: ADMIN_EMAIL alone works when ADMIN_SETUP_CODE is not set
  assert.ok(r.body.recoveryCode);
  admin = { token: r.body.token, id: r.body.user.id };

  r = await signup('Ama', 'ama@test.com');
  ama = { token: r.body.token, id: r.body.user.id, recovery: r.body.recoveryCode };
  assert.equal(r.body.user.role, 'user');
  refCode = r.body.user.refCode;

  assert.equal((await signup('Ama again', 'AMA@test.com')).status, 409);
  assert.equal((await call('POST', '/auth/login', { body: { email: 'ama@test.com', password: 'wrong1' } })).status, 401);
  assert.equal((await call('POST', '/auth/login', { body: { email: 'ama@test.com', password: 'secret12' } })).status, 200);
  assert.equal((await call('GET', '/me')).status, 401);

  r = await call('POST', '/auth/reset-password', { body: { email: 'ama@test.com', recoveryCode: ama.recovery.toLowerCase(), newPassword: 'newsecret1' } });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/me', { token: ama.token })).status, 401); // a reset signs out old logins
  ama.token = r.body.token;
  assert.equal((await call('POST', '/auth/login', { body: { email: 'ama@test.com', password: 'newsecret1' } })).status, 200);
});

test('a friend signs up with an invite code', async () => {
  const r = await signup('Kofi', 'kofi@test.com', { inviteCode: refCode });
  kofi = { token: r.body.token, id: r.body.user.id };
  const refs = await call('GET', '/referrals', { token: ama.token });
  assert.equal(refs.body.friends.length, 1);
  assert.equal(refs.body.friends[0].active, false);
});

test('free users see 5 tasks and never see answers or premium tasks', async () => {
  const r = await call('GET', '/tasks', { token: ama.token });
  assert.equal(r.body.tasks.length, 5);
  assert.ok(r.body.tasks.every((t) => !t.premium && t.answer === undefined && t.url === undefined));
  assert.equal((await call('POST', '/tasks/7/start', { token: ama.token })).status, 404); // premium task
});

test('poll task pays out, pays the inviter once, and cannot be repeated', async () => {
  const start = await call('POST', '/tasks/5/start', { token: kofi.token });
  assert.equal(start.status, 200);
  assert.equal(start.body.options.length, 3);
  const done = await call('POST', '/tasks/5/complete', { token: kofi.token, body: { answer: 1 } });
  assert.equal(done.body.ok, true);
  assert.equal(done.body.reward, 5);
  assert.equal((await call('POST', '/tasks/5/start', { token: kofi.token })).status, 409);
  assert.equal((await call('POST', '/tasks/5/complete', { token: kofi.token, body: { answer: 1 } })).status, 409);

  const wallet = await call('GET', '/wallet', { token: ama.token });
  assert.equal(wallet.body.balance, 50); // referral bonus
  const refs = await call('GET', '/referrals', { token: ama.token });
  assert.equal(refs.body.friends[0].active, true);
});

test('watch task: too early is rejected, bots and wrong answers are caught, a real viewer is paid', async () => {
  await call('POST', '/tasks/1/start', { token: ama.token });
  let r = await call('POST', '/tasks/1/complete', { token: ama.token, body: { answer: 0 } });
  assert.equal(r.status, 400); // timer has not finished

  backdate(ama.id, 1, 15000); // exactly on time = answered instantly = bot behaviour
  r = await call('POST', '/tasks/1/complete', { token: ama.token, body: { answer: 0 } });
  assert.equal(r.body.ok, false);
  assert.equal(db.prepare('SELECT flags FROM users WHERE id=?').get(ama.id).flags, 1);
  assert.equal((await call('POST', '/tasks/1/start', { token: ama.token })).status, 409); // forfeited for today

  await call('POST', '/tasks/2/start', { token: ama.token });
  backdate(ama.id, 2, 25000 + 5000); // watched, then took 5s to read and answer
  r = await call('POST', '/tasks/2/complete', { token: ama.token, body: { answer: 1 } });
  assert.equal(r.body.ok, false); // wrong answer

  await call('POST', '/tasks/3/start', { token: ama.token });
  backdate(ama.id, 3, 10000);
  r = await call('POST', '/tasks/3/complete', { token: ama.token });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.reward, 8);
  assert.ok(r.body.achievements.includes('first'));
});

test('streak, spin and weekly challenge rules', async () => {
  let r = await call('POST', '/rewards/streak/claim', { token: ama.token });
  assert.equal(r.body.amount, 5);
  assert.equal((await call('POST', '/rewards/streak/claim', { token: ama.token })).status, 409);

  assert.equal((await call('POST', '/rewards/spin', { token: admin.token })).status, 403); // no task done yet
  // Ama has finished 3 of her 5 tasks (2 missed, 1 done): the wheel stays locked until all 5 are finished.
  let rw = (await call('GET', '/rewards', { token: ama.token })).body.spin;
  assert.equal(rw.unlocked, false);
  assert.deepEqual([rw.tasksFinished, rw.tasksTotal], [3, 5]);
  assert.equal((await call('POST', '/rewards/spin', { token: ama.token })).status, 403);
  await call('POST', '/tasks/4/start', { token: ama.token });
  backdate(ama.id, 4, 15000);
  assert.equal((await call('POST', '/tasks/4/complete', { token: ama.token })).body.ok, true);
  await call('POST', '/tasks/5/start', { token: ama.token });
  assert.equal((await call('POST', '/tasks/5/complete', { token: ama.token, body: { answer: 2 } })).body.ok, true);
  rw = (await call('GET', '/rewards', { token: ama.token })).body.spin;
  assert.equal(rw.unlocked, true);
  r = await call('POST', '/rewards/spin', { token: ama.token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.prizes, [20, 50, 100, 50, 200, 100, 500]); // prizes are 10x the old ones
  assert.ok(r.body.prizes.includes(r.body.prize));
  assert.equal(r.body.animals[r.body.index], r.body.animal);
  assert.equal(r.body.animals[r.body.prizes.indexOf(500)], 'dragon'); // the jackpot is the dragon
  assert.equal((await call('POST', '/rewards/spin', { token: ama.token })).status, 409);

  const ch = await call('GET', '/challenges', { token: ama.token });
  assert.equal(ch.body.challenges.length, 3);
  assert.equal((await call('POST', '/challenges/0/claim', { token: ama.token })).status, 400); // 20 tasks not reached
});

test('premium: request, admin approval, more tasks and premium tasks unlock', async () => {
  assert.equal((await call('POST', '/premium/upgrade', { token: ama.token, body: { plan: 1, reference: 'x' } })).status, 400);
  assert.equal((await call('POST', '/premium/upgrade', { token: ama.token, body: { plan: 1, reference: 'TX-12345' } })).status, 201);
  assert.equal((await call('POST', '/premium/upgrade', { token: ama.token, body: { plan: 1, reference: 'TX-99999' } })).status, 409);
  assert.equal((await call('GET', '/admin/upgrades', { token: ama.token })).status, 403);

  const list = await call('GET', '/admin/upgrades', { token: admin.token });
  assert.equal(list.body.upgrades.length, 1);
  assert.equal((await call('POST', `/admin/upgrades/${list.body.upgrades[0].id}/decide`, { token: admin.token, body: { approve: true } })).status, 200);

  const t = await call('GET', '/tasks', { token: ama.token });
  assert.equal(t.body.tasks.length, 10);
  assert.equal(t.body.tasks.filter((x) => x.premium).length, 4);
  assert.equal((await call('POST', '/tasks/7/start', { token: ama.token })).status, 200);
});

test('admin: task validation, create, ban, adjust, settings, stats, charts, csv', async () => {
  const A = (m, p, body) => call(m, p, { token: admin.token, body });
  assert.equal((await A('POST', '/admin/tasks', { type: 'watch', title: 'x', url: 'https://evil.com', tokens: 5, secs: 20, question: 'q?', options: ['a', 'b'] })).status, 400);
  assert.equal((await A('POST', '/admin/tasks', { type: 'watch', title: 'No question', url: 'https://youtu.be/abc', tokens: 5, secs: 20 })).status, 400);
  const made = await A('POST', '/admin/tasks', { type: 'watch', title: 'Real one', url: 'https://youtu.be/abc', tokens: 12, secs: 20, question: 'Colour of the car?', options: ['Red', 'Blue'], answer: 1, budget: 24 });
  assert.equal(made.status, 201);
  assert.equal(made.body.task.answer, 1);
  assert.equal((await A('PATCH', `/admin/tasks/${made.body.task.id}`, { tokens: 15 })).body.task.tokens, 15);

  assert.equal((await A('POST', `/admin/users/${kofi.id}/adjust`, { amount: -9999, note: 'too much' })).status, 400);
  assert.equal((await A('POST', `/admin/users/${kofi.id}/adjust`, { amount: 100, note: 'Missing tokens refund' })).body.balance, 105);
  assert.equal((await A('POST', `/admin/users/${admin.id}/ban`, { banned: true })).status, 400);
  assert.equal((await A('POST', `/admin/users/${kofi.id}/ban`, { banned: true })).status, 200);
  assert.equal((await call('GET', '/me', { token: kofi.token })).status, 401); // banning signs them out everywhere
  assert.equal((await call('POST', '/auth/login', { body: { email: 'kofi@test.com', password: 'secret12' } })).status, 403);
  await A('POST', `/admin/users/${kofi.id}/ban`, { banned: false });
  kofi.token = (await call('POST', '/auth/login', { body: { email: 'kofi@test.com', password: 'secret12' } })).body.token;

  assert.equal((await A('PUT', '/admin/settings', { paymentInfo: 'USDT TRC20: Txyz', launchAt: '2026-12-01T10:00:00.000Z' })).status, 200);
  assert.equal((await call('GET', '/premium', { token: ama.token })).body.paymentInfo, 'USDT TRC20: Txyz');

  const stats = await A('GET', '/admin/stats');
  assert.equal(stats.body.users, 3);
  assert.ok(stats.body.wtcPaidOut > 0);
  const charts = await A('GET', '/admin/charts?days=7');
  assert.equal(charts.body.days.length, 7);
  assert.equal(charts.body.days[6].signups, 3);
  const csv = await fetch(`${base}/admin/export/users.csv`, { headers: { authorization: `Bearer ${admin.token}` } });
  assert.match(await csv.text(), /ama@test.com/);
});

test('wallet history, leaderboard, notifications, support and public stats', async () => {
  const w = await call('GET', '/wallet', { token: ama.token });
  assert.ok(w.body.history.length >= 3);
  assert.equal(w.body.balance, w.body.history.reduce((a, h) => a + h.amount, 0)); // balance always equals the ledger
  const lb = await call('GET', '/leaderboard', { token: ama.token });
  assert.equal(lb.body.me.name, 'Ama');
  assert.ok(lb.body.top.length >= 1);
  assert.ok((await call('GET', '/notifications', { token: ama.token })).body.notifications.length > 0);
  assert.equal((await call('POST', '/support', { token: ama.token, body: { message: 'I did not get tokens' } })).status, 201);
  assert.equal((await call('POST', '/wallet/transfer', { token: ama.token })).status, 501);
  const pub = await fetch(`${base}/public/stats`);
  assert.equal((await pub.json()).members, 3);
  assert.equal((await call('GET', '/nope', { token: ama.token })).status, 404);
});

test('admin: user detail, audit log, announcements, task stats, fraud signals and economics', async () => {
  const A = (m, p, body) => call(m, p, { token: admin.token, body });

  const d = await A('GET', `/admin/users/${ama.id}`);
  assert.equal(d.body.user.email, 'ama@test.com');
  assert.ok(d.body.ledger.length > 0 && d.body.sessions.length > 0);
  assert.equal(d.body.referrals.length, 1);
  assert.equal(d.body.upgrades[0].status, 'approved');
  assert.equal((await A('GET', `/admin/users/${kofi.id}`)).body.invitedBy.name, 'Ama');
  assert.equal((await A('GET', '/admin/users/99999')).status, 404);
  assert.equal((await call('GET', `/admin/users/${ama.id}`, { token: ama.token })).status, 403);
  assert.ok(Array.isArray((await A('GET', `/admin/users/${ama.id}/ledger?before=2`)).body.ledger));

  const audit = await A('GET', '/admin/audit');
  const actions = audit.body.entries.map((e) => e.action);
  for (const a of ['task.create', 'task.update', 'user.ban', 'user.unban', 'user.adjust', 'upgrade.approve', 'settings.update']) assert.ok(actions.includes(a), `audit missing ${a}`);
  assert.equal(audit.body.entries[0].adminEmail, 'admin@test.com');

  assert.equal((await A('POST', '/admin/broadcasts', { message: 'hi', audience: 'all' })).status, 400);
  assert.equal((await A('GET', '/admin/broadcasts')).body.counts.all, 3);
  const sent = await A('POST', '/admin/broadcasts', { message: 'Premium members: new tasks today!', audience: 'premium' });
  assert.equal(sent.body.recipients, 1); // only Ama has a plan
  const amaNotes = (await call('GET', '/notifications', { token: ama.token })).body.notifications.map((n) => n.message);
  const kofiNotes = (await call('GET', '/notifications', { token: kofi.token })).body.notifications.map((n) => n.message);
  assert.ok(amaNotes.includes('Premium members: new tasks today!'));
  assert.ok(!kofiNotes.includes('Premium members: new tasks today!'));
  assert.equal((await A('POST', '/admin/broadcasts', { message: 'Everyone else', audience: 'free' })).body.recipients, 2);

  const stats = await A('GET', '/admin/tasks/stats?days=30');
  const poll = stats.body.tasks.find((t) => t.id === 5);
  assert.ok(poll.started >= 1 && poll.done >= 1 && poll.completionRate > 0);
  assert.ok(stats.body.tasks.length >= 15);

  const fraud = await A('GET', '/admin/fraud');
  assert.equal(fraud.body.clusters[0].count, 3); // all test accounts share one network
  assert.ok(fraud.body.flagged.some((u) => u.id === ama.id));

  const eco = await A('GET', '/admin/economics');
  assert.equal(eco.body.totals.revenueUsdt, 5); // the one approved Plus plan
  assert.ok(eco.body.totals.issuedWtc > 0 && eco.body.bySource.some((s) => s.kind === 'task'));
  assert.equal(eco.body.days.length, 30);
});
