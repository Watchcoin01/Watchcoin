process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.MAX_ACCOUNTS_PER_IP = '50';
process.env.JWT_SECRET = 'test-secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { db } = require('../src/db');
const S = require('../src/services');
const R = require('../src/rules');

let server, base, admin, ama, vip;
before(() => new Promise((resolve) => { server = createApp().listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; resolve(); }); }));
after(() => server.close());

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const signup = async (name, email) => (await call('POST', '/auth/signup', { body: { name, email, password: 'secret1' } })).body;
const dayOffset = (n) => R.dayKey(Date.now() + n * R.MS_DAY);
const TODAY = dayOffset(0), TOMORROW = dayOffset(1), IN3 = dayOffset(3);
const A = (m, p, body) => call(m, p, { token: admin.token, body });
const task = (title, schedule, extra = {}) => A('POST', '/admin/tasks', { type: 'like', title, url: 'https://youtu.be/abc', tokens: 10, secs: 10, schedule, ...extra });
const titles = (u, day) => S.availableTasks(db.prepare('SELECT * FROM users WHERE id=?').get(u.user.id), day).map((t) => t.title);

test('tasks can be set to every day or to chosen dates; users see only what is set for the day', async () => {
  admin = await signup('Boss', 'admin@test.com'); ama = await signup('Ama', 'ama@test.com'); vip = await signup('Vee', 'vee@test.com');
  db.prepare('UPDATE tasks SET active=0').run(); // clear the starter tasks so the test sees only its own

  const a = await task('Today only', { mode: 'dates', dates: [TODAY] });
  const b = await task('Tomorrow only', { mode: 'dates', dates: [TOMORROW] });
  const c = await task('Every day', { mode: 'daily', dates: [] });
  const d = await task('Mon to Wed run', { mode: 'dates', dates: [TODAY, TOMORROW, IN3] });
  const p = await task('Premium today', { mode: 'dates', dates: [TODAY] }, { premium: true });
  for (const r of [a, b, c, d, p]) assert.equal(r.status, 201);
  assert.deepEqual(a.body.task.schedule, { mode: 'dates', dates: [TODAY] });
  assert.deepEqual(c.body.task.schedule, { mode: 'daily', dates: [] });

  // today: the ones picked for today come first, then the every-day one. Premium is hidden from free users
  assert.deepEqual(titles(ama, TODAY), ['Today only', 'Mon to Wed run', 'Every day']);
  const tasksToday = await call('GET', '/tasks', { token: ama.token });
  assert.deepEqual(tasksToday.body.tasks.map((t) => t.title), ['Today only', 'Mon to Wed run', 'Every day']);
  // tomorrow and the day after look different, so nobody sees the same list twice in a row
  assert.deepEqual(titles(ama, TOMORROW), ['Tomorrow only', 'Mon to Wed run', 'Every day']);
  assert.deepEqual(titles(ama, IN3), ['Mon to Wed run', 'Every day']);
  assert.deepEqual(titles(ama, dayOffset(10)), ['Every day']);
});

test('the plan decides how many, and premium tasks appear only for subscribers', async () => {
  db.prepare('UPDATE users SET plan=1, plan_exp=? WHERE id=?').run(Date.now() + 864e5, vip.user.id);
  assert.deepEqual(titles(vip, TODAY), ['Today only', 'Mon to Wed run', 'Premium today', 'Every day']);
  // with five tasks scheduled for today, a free user is capped at 5 and a Plus user at 10
  for (let i = 1; i <= 6; i++) await task(`Extra ${i}`, { mode: 'dates', dates: [TODAY] });
  assert.equal(titles(ama, TODAY).length, 5);
  assert.equal(titles(vip, TODAY).length, 10);
});

test('invalid schedules are refused', async () => {
  assert.equal((await task('x', { mode: 'dates', dates: [] })).status, 400);
  assert.equal((await task('x', { mode: 'dates', dates: ['2026-13-40'] })).status, 400);
  assert.equal((await task('x', { mode: 'dates', dates: ['tomorrow'] })).status, 400);
  assert.equal((await task('x', { mode: 'dates', dates: [dayOffset(-2)] })).status, 400);
  assert.equal((await task('x', { mode: 'dates', dates: [dayOffset(500)] })).status, 400);
  assert.equal((await task('x', { mode: 'dates', dates: Array.from({ length: 401 }, (_, i) => dayOffset(i)) })).status, 400);
});

test('editing a schedule replaces the dates, and switching to every day clears them', async () => {
  const t = (await task('Movable', { mode: 'dates', dates: [TODAY] })).body.task;
  let r = await A('PATCH', `/admin/tasks/${t.id}`, { schedule: { mode: 'dates', dates: [TOMORROW, IN3] } });
  assert.deepEqual(r.body.task.schedule.dates, [TOMORROW, IN3]);
  assert.ok(!titles(ama, TODAY).includes('Movable') && titles(ama, TOMORROW).includes('Movable'));
  assert.equal((await A('PATCH', `/admin/tasks/${t.id}`, { title: 'Renamed' })).body.task.schedule.dates.length, 2); // editing something else keeps the dates
  r = await A('PATCH', `/admin/tasks/${t.id}`, { schedule: { mode: 'daily', dates: [] } });
  assert.deepEqual(r.body.task.schedule, { mode: 'daily', dates: [] });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM task_days WHERE task_id=?').get(t.id).c, 0);
  assert.equal((await A('PATCH', `/admin/tasks/${t.id}`, { schedule: { mode: 'dates', dates: [] } })).status, 400);
});

test('the coverage report shows what each coming day looks like and flags thin days', async () => {
  const r = (await A('GET', '/admin/schedule?days=5')).body;
  assert.equal(r.today, TODAY); assert.equal(r.days.length, 5); assert.equal(r.minFree, 5);
  assert.equal(r.days[0].date, TODAY);
  assert.ok(r.days[0].freeCount >= 5);
  const lastDay = r.days[4];
  assert.equal(lastDay.freeCount, lastDay.dated.filter((t) => !t.premium).length + r.evergreen.filter((t) => !t.premium).length);
  assert.ok(r.days[1].dated.some((t) => t.title === 'Tomorrow only'));
  assert.equal((await call('GET', '/admin/schedule', { token: ama.token })).status, 403);
});

test('a task planned for a later day does not notify everyone today', async () => {
  const before = db.prepare("SELECT COUNT(*) c FROM notifications WHERE message LIKE 'New task: Quiet future%'").get().c;
  await task('Quiet future', { mode: 'dates', dates: [IN3] });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE message LIKE 'New task: Quiet future%'").get().c, before);
  await task('Loud today', { mode: 'dates', dates: [TODAY] });
  assert.ok(db.prepare("SELECT COUNT(*) c FROM notifications WHERE message LIKE 'New task: Loud today%'").get().c >= 3);
});

test('a task can be done again on each date it is scheduled for', async () => {
  const t = (await task('Repeatable', { mode: 'dates', dates: [TODAY, TOMORROW] })).body.task;
  const tx = (day) => db.prepare("INSERT INTO sessions(user_id,task_id,day,status,started_at,finished_at) VALUES (?,?,?,'done',?,?)").run(ama.user.id, t.id, day, Date.now(), Date.now());
  tx(TODAY); tx(TOMORROW); // different days are different sessions
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sessions WHERE user_id=? AND task_id=?').get(ama.user.id, t.id).c, 2);
});

test('bulk add: many tasks across many days in one go, checked all together', async () => {
  const mk = (title, date, extra = {}) => ({ type: 'like', title, url: 'https://youtu.be/abc', tokens: 7, secs: 10, schedule: { mode: 'dates', dates: [date] }, ...extra });
  const D = (n) => dayOffset(n + 20); // days that nothing else in these tests uses
  const before = db.prepare('SELECT COUNT(*) c FROM tasks').get().c;

  // one bad row stops the whole batch, and says which row
  const bad = await A('POST', '/admin/tasks/bulk', { tasks: [mk('Fine', D(0)), mk('Bad link', D(1), { url: 'https://evil.example' }), mk('Past', dayOffset(-3)), { type: 'watch', title: 'No question', url: 'https://youtu.be/abc', tokens: 5, secs: 20, schedule: { mode: 'dates', dates: [D(2)] } }] });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.rows.map((r) => r.row), [2, 3, 4]);
  assert.match(bad.body.rows[0].error, /YouTube/); assert.match(bad.body.rows[1].error, /in the past/); assert.match(bad.body.rows[2].error, /question/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tasks').get().c, before); // nothing was saved

  const ok = await A('POST', '/admin/tasks/bulk', { tasks: Array.from({ length: 6 }, (_, i) => mk(`Batch ${i + 1}`, D(Math.floor(i / 2)))) }); // 2 per day over 3 days
  assert.equal(ok.status, 201); assert.equal(ok.body.created, 6); assert.equal(ok.body.days, 3);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tasks').get().c, before + 6);
  const pos = ok.body.ids.map((id) => db.prepare('SELECT position FROM tasks WHERE id=?').get(id).position);
  assert.deepEqual(pos, [...pos].sort((a, b) => a - b)); // they keep the order they were pasted in
  assert.deepEqual(titles(ama, D(1)).filter((t) => t.startsWith('Batch')), ['Batch 3', 'Batch 4']);

  assert.equal((await A('POST', '/admin/tasks/bulk', { tasks: [] })).status, 400);
  assert.equal((await A('POST', '/admin/tasks/bulk', { tasks: Array.from({ length: 101 }, () => mk('x', D(0))) })).status, 400);
  assert.equal((await call('POST', '/admin/tasks/bulk', { token: ama.token, body: { tasks: [mk('x', D(0))] } })).status, 403);
});

test('bulk add sends one notice, and only when something is available today', async () => {
  const mk = (title, dates) => ({ type: 'like', title, url: 'https://youtu.be/abc', tokens: 7, secs: 10, schedule: { mode: 'dates', dates } });
  const count = () => db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id=? AND message LIKE '%new task%'").get(ama.user.id).c;
  const c0 = count();
  await A('POST', '/admin/tasks/bulk', { tasks: [mk('Later 1', [dayOffset(40)]), mk('Later 2', [dayOffset(41)])] });
  assert.equal(count(), c0); // all planned for later: no notice
  await A('POST', '/admin/tasks/bulk', { tasks: [mk('Now 1', [TODAY]), mk('Now 2', [TODAY]), mk('Now 3', [TODAY])] });
  assert.equal(count(), c0 + 1); // one notice, not three
  assert.ok(db.prepare("SELECT message FROM notifications WHERE user_id=? ORDER BY id DESC").get(ama.user.id).message.includes('3 new tasks'));
});

test('copy a day onto other days', async () => {
  const src = dayOffset(60), a = dayOffset(61), b = dayOffset(62);
  await task('Copy me 1', { mode: 'dates', dates: [src] }); await task('Copy me 2', { mode: 'dates', dates: [src] }); await task('Always', { mode: 'daily', dates: [] });
  const r = await A('POST', '/admin/schedule/copy', { from: src, to: [a, b, src] });
  assert.equal(r.status, 200); assert.equal(r.body.tasks, 2); assert.equal(r.body.days, 2); // the source day itself is skipped
  assert.deepEqual(titles(ama, a).filter((t) => t.startsWith('Copy')).sort(), ['Copy me 1', 'Copy me 2']);
  assert.ok(titles(ama, b).includes('Copy me 1') && titles(ama, src).includes('Copy me 1'));
  assert.equal((await A('POST', '/admin/schedule/copy', { from: src, to: [a] })).status, 200); // copying twice does no harm
  assert.equal(db.prepare("SELECT COUNT(*) c FROM task_days d JOIN tasks t ON t.id=d.task_id WHERE t.title='Copy me 1' AND d.day=?").get(a).c, 1);
  assert.equal((await A('POST', '/admin/schedule/copy', { from: dayOffset(80), to: [a] })).status, 400); // nothing set that day
  assert.equal((await A('POST', '/admin/schedule/copy', { from: src, to: [dayOffset(-1)] })).status, 400);
  assert.equal((await A('POST', '/admin/schedule/copy', { from: src, to: ['nope'] })).status, 400);
  assert.equal((await A('POST', '/admin/schedule/copy', { from: src, to: [src] })).status, 400);
});
