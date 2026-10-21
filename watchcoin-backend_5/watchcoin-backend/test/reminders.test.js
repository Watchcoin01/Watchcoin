const http = require('http');
const PORT = 48000 + Math.floor(Math.random() * 900);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.MAX_ACCOUNTS_PER_IP = '50';
process.env.JWT_SECRET = 'test-secret';
process.env.RESEND_API_KEY = 're_test_key';
process.env.RESEND_BASE_URL = `http://127.0.0.1:${PORT}`;
process.env.MAIL_FROM = 'Watchcoin <hello@example.com>';
process.env.PUSH_TASKS_HOUR = '8';
process.env.PUSH_STREAK_HOUR = '18';
process.env.TZ_OFFSET_MINUTES = '0';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { db } = require('../src/db');
const push = require('../src/push');
const reminders = require('../src/reminders');
const R = require('../src/rules');

const mails = [], pushes = [];
const fakeResend = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { mails.push({ auth: req.headers.authorization, ...JSON.parse(Buffer.concat(c).toString()) }); res.setHeader('content-type', 'application/json'); res.end('{"id":"1"}'); }); });
push.transport.send = async (sub, payload) => { if (sub.endpoint.includes('gone')) { const e = new Error('Gone'); e.statusCode = 410; throw e; } pushes.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); };

let server, base, admin;
before(() => new Promise((resolve) => { fakeResend.listen(PORT, () => { server = createApp().listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; resolve(); }); }); }));
after(() => { server.close(); fakeResend.close(); });
async function call(method, p, { token, body } = {}) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; } return { status: res.status, body: json };
}
const signup = async (n, e) => (await call('POST', '/auth/signup', { body: { name: n, email: e, password: 'secret1' } })).body;
const H = 3600000, D = 24 * H;
const setPlan = (u, plan, expIn) => db.prepare('UPDATE users SET plan=?, plan_exp=? WHERE id=?').run(plan, Date.now() + expIn, u.user.id);
const sub = (u, endpoint) => db.prepare('INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,created_at) VALUES (?,?,?,?,?)').run(u.user.id, endpoint, 'p'.repeat(20), 'a'.repeat(10), Date.now());
const planMails = () => mails.filter((m) => /plan/i.test(m.subject)); // signing up also sends a verification email, so look only at plan reminders
const notes = (u) => db.prepare('SELECT message FROM notifications WHERE user_id=? ORDER BY id').all(u.user.id).map((n) => n.message);
const at = (hour) => { const d = new Date(); d.setUTCHours(hour, 5, 0, 0); return d.getTime(); }; // today at hour:05 server time

let a, b, c, d, e;
test('plan reminders go out 3 days before, 1 day before, and after a plan ends, once each', async () => {
  admin = await signup('Boss', 'admin@test.com');
  [a, b, c, d, e] = await Promise.all([signup('Ama', 'ama@t.com'), signup('Bea', 'bea@t.com'), signup('Cee', 'cee@t.com'), signup('Dee', 'dee@t.com'), signup('Eve', 'eve@t.com')]);
  setPlan(a, 1, 2.5 * D); setPlan(b, 2, 20 * H); setPlan(c, 1, -1 * D); setPlan(d, 3, 10 * D); // Eve stays on the free plan
  sub(a, 'https://push.example/ama'); sub(b, 'https://push.example/gone-bea');

  assert.equal(await reminders.runPlanReminders(), 3); // Ama, Bea, Cee. Dee is too far off, Eve has no plan
  assert.match(notes(a).at(-1), /^Your Plus plan ends in 3 days\. It ends on .* Renew to keep 10 tasks a day\.$/);
  assert.match(notes(b).at(-1), /^Your Pro plan ends within a day\. Renew now to keep 20 tasks a day without a break\.$/);
  assert.match(notes(c).at(-1), /^Your Plus plan has ended\. You are back to 5 tasks a day\./);
  assert.ok(!notes(d).some((m) => /plan/i.test(m) && /ends/.test(m)) && !notes(e).some((m) => /ends/.test(m)));

  assert.deepEqual(planMails().map((m) => m.to[0]).sort(), ['ama@t.com', 'bea@t.com', 'cee@t.com']);
  assert.equal(planMails()[0].auth, 'Bearer re_test_key'); assert.equal(planMails()[0].from, 'Watchcoin <hello@example.com>');
  assert.match(planMails().find((m) => m.to[0] === 'ama@t.com').text, /Open Watchcoin to renew: http/); assert.ok(planMails()[0].html.includes('<div'));
  assert.deepEqual(pushes.map((p) => [p.endpoint, p.tag, p.title]), [['https://push.example/ama', 'plan', 'Your Plus plan ends in 3 days']]);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM push_subscriptions WHERE endpoint LIKE ?').get('%gone%').c, 0); // a phone that is gone is forgotten

  assert.equal(await reminders.runPlanReminders(), 0); assert.equal(planMails().length, 3); // running again sends nothing new
});

test('when a plan is renewed, the next run gets its own reminders; a 1-day notice replaces the 3-day one', async () => {
  const before = planMails().length;
  setPlan(a, 1, 0.8 * D); // renewed for a short time, ending within a day. This is a new run of the plan, so it is allowed to be told again
  assert.equal(await reminders.runPlanReminders(), 1);
  assert.match(notes(a).at(-1), /ends within a day/);
  assert.equal(planMails().length, before + 1);
});

test('people can turn reminder emails and notifications off, and still get the in-app notice', async () => {
  const f = await signup('Fay', 'fay@t.com'); sub(f, 'https://push.example/fay');
  assert.equal((await call('PUT', '/me/prefs', { token: f.token, body: { email_plan: false, push_plan: false } })).body.prefs.email_plan, false);
  setPlan(f, 1, 2 * D);
  const mails0 = planMails().length, push0 = pushes.length;
  await reminders.runPlanReminders();
  assert.equal(planMails().length, mails0); assert.equal(pushes.length, push0);
  assert.match(notes(f).at(-1), /ends in 2 days/);
  assert.deepEqual((await call('GET', '/me/prefs', { token: f.token })).body.prefs, { push_tasks: true, push_streak: true, push_plan: false, email_plan: false });
  assert.equal((await call('PUT', '/me/prefs', { token: f.token, body: { push_plan: 'yes' } })).status, 400);
});

test('the app shows a recently ended plan so it can offer renewal, for a week', async () => {
  assert.equal((await call('GET', '/me', { token: c.token })).body.user.planEnded.name, 'Plus');
  assert.equal((await call('GET', '/me', { token: e.token })).body.user.planEnded, null);
  setPlan(c, 1, -8 * D);
  assert.equal((await call('GET', '/me', { token: c.token })).body.user.planEnded, null);
});

test('daily pushes: tasks ready in the morning, streak warning in the evening, once a day each', async () => {
  const g = await signup('Gus', 'gus@t.com'); const h = await signup('Hal', 'hal@t.com'); const i = await signup('Ivy', 'ivy@t.com');
  db.prepare('DELETE FROM push_subscriptions').run(); // only the three phones below
  sub(g, 'https://push.example/gus'); sub(h, 'https://push.example/hal'); sub(i, 'https://push.example/ivy');
  db.prepare('UPDATE users SET streak=4 WHERE id=?').run(h.user.id);
  db.prepare("INSERT INTO sessions(user_id,task_id,day,status,started_at,finished_at) VALUES (?,1,?,'done',1,1)").run(i.user.id, R.dayKey()); // Ivy has already done a task today
  pushes.length = 0;

  assert.equal(await reminders.runDailyPushes(at(3)), 0); // too early: nothing
  const morning = await reminders.runDailyPushes(at(8));
  const to = (kind) => pushes.filter((p) => p.tag === kind).map((p) => p.endpoint.split('/').pop()).sort();
  assert.deepEqual(to('tasks'), ['gus', 'hal']); // Ivy already started today, so no nudge
  assert.match(pushes.find((p) => p.tag === 'tasks').body, /^\d+ tasks are waiting\. You can earn up to \d+ WTC today\.$/);
  assert.equal(morning, 2);
  assert.equal(await reminders.runDailyPushes(at(9)), 0); // later the same morning: not again

  const evening = await reminders.runDailyPushes(at(18));
  assert.deepEqual(to('streak'), ['hal']); assert.equal(evening, 1); // only Hal has a streak that could be lost
  assert.equal(pushes.find((p) => p.tag === 'streak').title, 'Your 4-day streak ends tonight');
  assert.equal(await reminders.runDailyPushes(at(19)), 0);

  db.prepare("UPDATE users SET last_claim=? WHERE id=?").run(R.dayKey(), h.user.id); // if Hal had claimed, no warning
  db.prepare('DELETE FROM push_log').run(); pushes.length = 0;
  await call('PUT', '/me/prefs', { token: g.token, body: { push_tasks: false } });
  await reminders.runDailyPushes(at(8)); await reminders.runDailyPushes(at(18));
  assert.deepEqual(to('tasks'), ['hal']); assert.deepEqual(to('streak'), []); // Gus turned tasks off, Hal already claimed
});

test('admin sees which plans are about to end, with the money at stake', async () => {
  const r = (await call('GET', '/admin/expiring?days=7', { token: admin.token })).body;
  assert.ok(r.users.every((u) => u.daysLeft >= 1 && u.daysLeft <= 7));
  assert.ok(r.users.some((u) => u.name === 'Ama') && !r.users.some((u) => u.name === 'Dee')); // Dee has 10 days left
  assert.equal(r.atRiskUsdt, r.users.reduce((s, u) => s + u.priceUsdt, 0));
  assert.equal((await call('GET', '/admin/expiring?days=30', { token: admin.token })).body.users.some((u) => u.name === 'Dee'), true);
  assert.equal((await call('GET', '/admin/expiring', { token: a.token })).status, 403);
});
