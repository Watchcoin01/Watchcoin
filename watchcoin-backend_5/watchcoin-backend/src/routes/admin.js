const express = require('express');
const { z } = require('zod');
const { db, getSetting, setSetting } = require('../db');
const R = require('../rules');
const { HttpError, parse, csvCell } = require('../util');
const S = require('../services');
const cfg = require('../config');
const ps = require('../paystack');
const tron = require('../tron');
const push = require('../push');

const router = express.Router();

// Support people can look things up and answer people. They cannot move money, change settings, or edit tasks.
const SUPPORT_CAN_READ = [/^\/users(\/\d+(\/ledger)?)?$/, /^\/tickets$/, /^\/payments$/, /^\/crypto-orders$/, /^\/upgrades$/, /^\/fraud$/, /^\/schedule$/, /^\/tasks$/, /^\/tasks\/stats$/];
router.use((req, res, next) => {
  if (req.user.role === 'admin') return next();
  const p = req.path;
  if (req.user.role === 'support' && ((req.method === 'GET' && SUPPORT_CAN_READ.some((r) => r.test(p))) || (req.method === 'POST' && /^\/tickets\/\d+\/resolve$/.test(p)))) return next();
  throw new HttpError(403, 'Your role cannot do this');
});
// Every change an admin makes is written here, so you can always see who did what and when.
const audit = (req, action, type = '', targetId = null, detail = '') =>
  db.prepare('INSERT INTO audit_log(admin_id,action,target_type,target_id,detail,created_at) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, action, type, targetId, String(detail).slice(0, 300), Date.now());
const id = (req) => parse(z.coerce.number().int().positive(), req.params.id);

// ---------- tasks ----------
const YT = /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//;
const taskBody = z.object({
  type: z.enum(['watch', 'like', 'subscribe', 'poll']),
  title: z.string().trim().min(1).max(120),
  url: z.string().trim().max(300).default(''),
  tokens: z.number().int().min(1).max(100000),
  secs: z.number().int().min(0).max(3600).default(0),
  question: z.string().trim().max(200).default(''),
  options: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  answer: z.number().int().min(0).default(0),
  premium: z.boolean().default(false),
  doubleHours: z.number().min(0).max(720).default(0),
  budget: z.number().int().min(0).default(0),
  // Pictures are stored as a data URL. Only plain pictures are allowed (no SVG, which can carry scripts).
  cover: z.string().max(200000).refine((s) => s === '' || /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s), 'must be a JPEG, PNG or WebP picture').default(''),
  active: z.boolean().default(true),
  position: z.number().int().min(0).optional(),
  // When the task appears: every day, or only on the chosen dates (YYYY-MM-DD).
  schedule: z.object({ mode: z.enum(['daily', 'dates']).default('daily'), dates: z.array(z.string()).max(400).default([]) }).default({ mode: 'daily', dates: [] }),
});

const validDate = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return false;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return t.getUTCFullYear() === +m[1] && t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3];
};
function checkSchedule(sc, old = []) {
  if (sc.mode !== 'dates') return;
  if (!sc.dates.length) throw new HttpError(400, 'schedule: choose at least one date, or switch the task to every day');
  const today = R.dayKey(), last = R.dayKey(Date.now() + 400 * R.MS_DAY);
  for (const d of sc.dates) {
    if (!validDate(d)) throw new HttpError(400, `schedule: ${d} is not a valid date`);
    if (d < today && !old.includes(d)) throw new HttpError(400, `schedule: ${d} is in the past`);
    if (d > last) throw new HttpError(400, `schedule: ${d} is too far ahead`);
  }
}
const datesOf = (taskId) => db.prepare('SELECT day FROM task_days WHERE task_id=? ORDER BY day').all(taskId).map((r) => r.day);
function setSchedule(taskId, sc) {
  db.prepare('UPDATE tasks SET daily=? WHERE id=?').run(sc.mode === 'daily' ? 1 : 0, taskId);
  db.prepare('DELETE FROM task_days WHERE task_id=?').run(taskId);
  if (sc.mode === 'dates') { const ins = db.prepare('INSERT OR IGNORE INTO task_days(task_id,day) VALUES (?,?)'); for (const d of new Set(sc.dates)) ins.run(taskId, d); }
}

function checkTask(t) {
  if (t.type !== 'poll') {
    if (!YT.test(t.url)) throw new HttpError(400, 'url: use a https YouTube link (youtube.com or youtu.be)');
    if (t.secs < 5) throw new HttpError(400, 'secs: watch time must be at least 5 seconds');
  }
  if (t.type === 'watch' && !t.question) throw new HttpError(400, 'question: watch tasks need a question that proves the viewer watched');
  if (t.type === 'poll' || t.question) {
    if (!t.question || t.options.length < 2) throw new HttpError(400, 'question and at least 2 options are needed');
    if (t.type !== 'poll' && t.answer >= t.options.length) throw new HttpError(400, 'answer: must be the index of one of the options');
  }
}

const toApi = (t) => ({
  id: t.id, type: t.type, title: t.title, url: t.url, tokens: t.tokens, secs: t.secs, question: t.question,
  options: JSON.parse(t.options), answer: t.answer, premium: !!t.premium, active: !!t.active, hasCover: !!t.cover, coverUrl: t.cover ? `/api/covers/${t.id}?v=${t.cover_v}` : '',
  doubleUntil: t.double_until || null, budget: t.budget, spent: t.spent, completed: t.completed, position: t.position,
  schedule: { mode: t.daily ? 'daily' : 'dates', dates: t.daily ? [] : datesOf(t.id) },
});

router.get('/tasks', (req, res) => {
  res.json({ tasks: db.prepare('SELECT * FROM tasks ORDER BY position, id').all().map(toApi) });
});

// Saves one task with its dates and cover. Call it inside a transaction.
function insertTask(b) {
  const pos = db.prepare('SELECT COALESCE(MAX(position),-1)+1 p FROM tasks').get().p;
  const r = db.prepare(`INSERT INTO tasks(type,title,url,tokens,secs,question,options,answer,cover,premium,active,double_until,budget,position,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.type, b.title, b.url, b.tokens, b.secs, b.question, JSON.stringify(b.options), b.answer,
    b.cover, +b.premium, +b.active, b.doubleHours ? Date.now() + b.doubleHours * 3600000 : 0, b.budget, b.position ?? pos, Date.now());
  setSchedule(r.lastInsertRowid, b.schedule);
  if (b.cover) db.prepare('UPDATE tasks SET cover_v=? WHERE id=?').run(Date.now(), r.lastInsertRowid);
  return r.lastInsertRowid;
}
// Everyone is told about a new task only when it is available today. Tasks planned for later days appear on their day.
const availableToday = (b) => b.schedule.mode === 'daily' || b.schedule.dates.includes(R.dayKey());
const tellEveryone = (text) => { for (const u of db.prepare('SELECT id FROM users WHERE banned=0').all()) S.notify(u.id, text); };

router.post('/tasks', (req, res) => {
  const b = parse(taskBody, req.body);
  checkTask(b);
  checkSchedule(b.schedule);
  const id = db.transaction(() => { const tid = insertTask(b); if (availableToday(b)) tellEveryone(`New task: ${b.title} (+${b.tokens} WTC)`); return tid; })();
  audit(req, 'task.create', 'task', id, `${b.title} (${b.tokens} WTC)`);
  res.status(201).json({ task: toApi(db.prepare('SELECT * FROM tasks WHERE id=?').get(id)) });
});

// Add many tasks at once. Every row is checked first, and nothing is saved unless every row is fine.
router.post('/tasks/bulk', (req, res) => {
  const raw = parse(z.object({ tasks: z.array(z.unknown()).min(1, 'add at least one task').max(100, 'add up to 100 tasks at a time') }), req.body).tasks;
  const rows = [], errors = [];
  raw.forEach((t, i) => {
    const r = taskBody.safeParse(t);
    if (!r.success) return errors.push({ row: i + 1, error: r.error.issues.map((x) => `${x.path.join('.') || 'row'}: ${x.message}`).join('; ') });
    try { checkTask(r.data); checkSchedule(r.data.schedule); rows.push(r.data); } catch (e) { errors.push({ row: i + 1, error: e.message }); }
  });
  if (errors.length) throw new HttpError(400, `${errors.length} row${errors.length === 1 ? ' needs' : 's need'} fixing. Nothing was saved.`, { rows: errors });
  const ids = db.transaction(() => {
    const made = rows.map(insertTask), today = rows.filter(availableToday).length;
    if (today) tellEveryone(today === 1 ? `New task: ${rows.find(availableToday).title}` : `${today} new tasks are available today`);
    return made;
  })();
  const days = new Set(rows.flatMap((r) => (r.schedule.mode === 'dates' ? r.schedule.dates : []))).size;
  audit(req, 'task.bulk', 'task', null, `${rows.length} tasks${days ? ` across ${days} day${days === 1 ? '' : 's'}` : ''}`);
  res.status(201).json({ created: ids.length, ids, days });
});

// Copy what is set for one day onto other days. Tasks set to "every day" need no copying.
router.post('/schedule/copy', (req, res) => {
  const b = parse(z.object({ from: z.string(), to: z.array(z.string()).min(1).max(90) }), req.body);
  const today = R.dayKey(), last = R.dayKey(Date.now() + 400 * R.MS_DAY);
  for (const d of [b.from, ...b.to]) if (!validDate(d)) throw new HttpError(400, `${d} is not a valid date`);
  for (const d of b.to) if (d < today) throw new HttpError(400, `${d} is in the past`); else if (d > last) throw new HttpError(400, `${d} is too far ahead`);
  const targets = [...new Set(b.to)].filter((d) => d !== b.from);
  if (!targets.length) throw new HttpError(400, 'Choose at least one other day');
  const ids = db.prepare('SELECT t.id FROM tasks t JOIN task_days d ON d.task_id=t.id WHERE t.active=1 AND t.daily=0 AND d.day=?').all(b.from).map((r) => r.id);
  if (!ids.length) throw new HttpError(400, 'Nothing is set for that day yet');
  db.transaction(() => { const ins = db.prepare('INSERT OR IGNORE INTO task_days(task_id,day) VALUES (?,?)'); for (const id of ids) for (const d of targets) ins.run(id, d); })();
  audit(req, 'schedule.copy', 'task', null, `${ids.length} tasks from ${b.from} to ${targets.length} day${targets.length === 1 ? '' : 's'}`);
  res.json({ tasks: ids.length, days: targets.length });
});

router.patch('/tasks/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM tasks WHERE id=?').get(id(req));
  if (!cur) throw new HttpError(404, 'Task not found');
  // Keep only the fields the admin actually sent, so schema defaults never overwrite existing values.
  const parsed = parse(taskBody.partial(), req.body);
  const patch = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in req.body));
  const old = { ...toApi(cur), cover: cur.cover }; // the picture itself is only kept here so an edit does not lose it
  const merged = { ...old, ...patch };
  const full = parse(taskBody, { ...merged, doubleHours: 0 });
  checkTask(full);
  if ('schedule' in patch) checkSchedule(full.schedule, old.schedule.dates);
  const doubleUntil = patch.doubleHours === undefined ? cur.double_until : patch.doubleHours ? Date.now() + patch.doubleHours * 3600000 : 0;
  db.prepare(`UPDATE tasks SET type=?,title=?,url=?,tokens=?,secs=?,question=?,options=?,answer=?,cover=?,premium=?,active=?,double_until=?,budget=?,position=? WHERE id=?`)
    .run(full.type, full.title, full.url, full.tokens, full.secs, full.question, JSON.stringify(full.options), full.answer, full.cover,
      +full.premium, +full.active, doubleUntil, full.budget, full.position ?? cur.position, cur.id);
  if ('cover' in patch && full.cover !== cur.cover) db.prepare('UPDATE tasks SET cover_v=? WHERE id=?').run(Date.now(), cur.id);
  if ('schedule' in patch) db.transaction(() => setSchedule(cur.id, full.schedule))();
  audit(req, 'task.update', 'task', cur.id, `${cur.title}: ${Object.keys(patch).join(', ')}`);
  res.json({ task: toApi(db.prepare('SELECT * FROM tasks WHERE id=?').get(cur.id)) });
});

// Tasks are hidden, not erased, so past completions and the ledger stay intact.
router.delete('/tasks/:id', (req, res) => {
  const r = db.prepare('UPDATE tasks SET active=0 WHERE id=?').run(id(req));
  if (!r.changes) throw new HttpError(404, 'Task not found');
  audit(req, 'task.hide', 'task', id(req));
  res.json({ ok: true });
});

// ---------- schedule: what users will see on each coming day ----------
router.get('/schedule', (req, res) => {
  const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }), req.query);
  const tasks = new Map(db.prepare('SELECT id, title, premium, daily, tokens, type FROM tasks WHERE active=1').all().map((t) => [t.id, t]));
  const byDay = new Map();
  for (const r of db.prepare('SELECT task_id, day FROM task_days').all()) { if (tasks.has(r.task_id) && !tasks.get(r.task_id).daily) (byDay.get(r.day) || byDay.set(r.day, []).get(r.day)).push(tasks.get(r.task_id)); }
  const evergreen = [...tasks.values()].filter((t) => t.daily);
  const pub = (t) => ({ id: t.id, title: t.title, premium: !!t.premium, tokens: t.tokens, type: t.type });
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = R.dayKey(Date.now() + i * R.MS_DAY), dated = byDay.get(date) || [];
    out.push({ date, dated: dated.map(pub), freeCount: dated.filter((t) => !t.premium).length + evergreen.filter((t) => !t.premium).length, premiumCount: dated.filter((t) => t.premium).length + evergreen.filter((t) => t.premium).length });
  }
  res.json({ today: R.dayKey(), tzOffsetMinutes: cfg.tzOffsetMin, minFree: R.PLANS[0].tasksPerDay, evergreen: evergreen.map(pub), days: out });
});

// ---------- users ----------
router.get('/users', (req, res) => {
  const q = parse(z.object({ search: z.string().trim().max(80).default(''), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }), req.query);
  const like = `%${q.search}%`;
  const users = db.prepare(`SELECT id, email, name, role, balance, lifetime, plan, plan_exp, flags, banned, email_verified, created_at,
      (SELECT COUNT(*) FROM users r WHERE r.referred_by=users.id) referrals FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(like, like, q.limit, q.offset);
  res.json({ users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, balance: u.balance, lifetime: u.lifetime,
    plan: R.PLANS[R.activePlan(u)].name, flags: u.flags, banned: !!u.banned, emailVerified: !!u.email_verified, referrals: u.referrals, createdAt: u.created_at })) });
});

router.post('/users/:id/ban', (req, res) => {
  const { banned } = parse(z.object({ banned: z.boolean() }), req.body);
  const u = S.getUser(id(req));
  if (!u) throw new HttpError(404, 'User not found');
  if (u.role === 'admin') throw new HttpError(400, 'Admins cannot be banned');
  db.prepare('UPDATE users SET banned=? WHERE id=?').run(+banned, u.id);
  audit(req, banned ? 'user.ban' : 'user.unban', 'user', u.id, u.email);
  res.json({ ok: true, banned });
});

// For support cases such as missing tokens. Every change is written to the user's ledger.
router.post('/users/:id/adjust', (req, res) => {
  const b = parse(z.object({ amount: z.number().int().refine((n) => n !== 0, 'cannot be 0'), note: z.string().trim().min(3).max(200) }), req.body);
  const u = S.getUser(id(req));
  if (!u) throw new HttpError(404, 'User not found');
  if (u.balance + b.amount < 0) throw new HttpError(400, 'This would make the balance negative');
  db.transaction(() => {
    S.credit(u.id, b.amount, 'adjust', b.note);
    S.notify(u.id, `Your balance was adjusted by ${b.amount > 0 ? '+' : ''}${b.amount} WTC: ${b.note}`);
  })();
  audit(req, 'user.adjust', 'user', u.id, `${b.amount > 0 ? '+' : ''}${b.amount} WTC for ${u.email}: ${b.note}`);
  res.json({ balance: S.getUser(u.id).balance });
});

// ---------- premium upgrades ----------
router.get('/upgrades', (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected']).default('pending') }), req.query);
  const rows = db.prepare(`SELECT g.id, g.plan, g.reference, g.status, g.created_at createdAt, u.id userId, u.name, u.email
    FROM upgrades g JOIN users u ON u.id=g.user_id WHERE g.status=? ORDER BY g.id`).all(status);
  res.json({ upgrades: rows.map((r) => ({ ...r, planName: R.PLANS[r.plan].name, priceUsdt: R.PLANS[r.plan].priceUsdt })) });
});

router.post('/upgrades/:id/decide', (req, res) => {
  const { approve } = parse(z.object({ approve: z.boolean() }), req.body);
  const g = db.prepare('SELECT * FROM upgrades WHERE id=?').get(id(req));
  if (!g) throw new HttpError(404, 'Request not found');
  if (g.status !== 'pending') throw new HttpError(409, 'Already decided');
  db.transaction(() => {
    db.prepare('UPDATE upgrades SET status=?, decided_at=? WHERE id=?').run(approve ? 'approved' : 'rejected', Date.now(), g.id);
    if (approve) {
      S.activatePlan(g.user_id, g.plan);
    } else {
      S.notify(g.user_id, 'We could not confirm your upgrade payment. Please contact support.');
    }
  })();
  audit(req, approve ? 'upgrade.approve' : 'upgrade.reject', 'user', g.user_id, `${R.PLANS[g.plan].name} plan, ref ${g.reference}`);
  res.json({ ok: true, status: approve ? 'approved' : 'rejected' });
});

// ---------- support ----------
router.get('/tickets', (req, res) => {
  const { resolved } = parse(z.object({ resolved: z.enum(['0', '1']).default('0') }), req.query);
  res.json({ tickets: db.prepare(`SELECT t.id, t.message, t.resolved, t.created_at createdAt, u.id userId, u.name, u.email
    FROM tickets t JOIN users u ON u.id=t.user_id WHERE t.resolved=? ORDER BY t.id`).all(Number(resolved)) });
});
router.post('/tickets/:id/resolve', (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(id(req));
  if (!t) throw new HttpError(404, 'Ticket not found');
  db.prepare('UPDATE tickets SET resolved=1 WHERE id=?').run(t.id);
  S.notify(t.user_id, 'Your support request was resolved.');
  audit(req, 'ticket.resolve', 'user', t.user_id, t.message.slice(0, 80));
  res.json({ ok: true });
});

// ---------- settings ----------
const settingsOut = () => ({ paymentInfo: getSetting('payment_info'), launchAt: getSetting('launch_at') || null, tokenPrice: S.tokenPrice(), paystack: ps.adminInfo(), crypto: tron.adminInfo() });
router.get('/settings', (req, res) => {
  res.json(settingsOut());
});
router.put('/settings', (req, res) => {
  const b = parse(z.object({
    paymentInfo: z.string().trim().min(1).max(500).optional(),
    launchAt: z.union([z.literal(''), z.string().datetime()]).nullable().optional(),
    tokenPrice: z.number().positive().max(1000).optional(),
    paystackRate: z.number().positive().max(1000000).optional(),
    tronAddress: z.union([z.literal(''), z.string().trim().regex(tron.ADDRESS, 'must be a TRON address starting with T')]).optional(),
  }), req.body);
  if (b.paymentInfo !== undefined) setSetting('payment_info', b.paymentInfo);
  if (b.launchAt !== undefined) setSetting('launch_at', b.launchAt || '');
  if (b.tokenPrice !== undefined) setSetting('token_price', b.tokenPrice);
  if (b.paystackRate !== undefined) setSetting('paystack_rate', b.paystackRate);
  if (b.tronAddress !== undefined) setSetting('tron_address', b.tronAddress);
  audit(req, 'settings.update', 'settings', null, Object.keys(b).map((k) => (k === 'tokenPrice' ? `tokenPrice=${b.tokenPrice}` : k === 'paystackRate' ? `paystackRate=${b.paystackRate}` : k === 'tronAddress' ? `tronAddress=${b.tronAddress || 'removed'}` : k)).join(', '));
  res.json(settingsOut());
});

// ---------- stats, charts, export ----------
router.get('/stats', (req, res) => {
  const one = (sql, ...a) => db.prepare(sql).get(...a).v;
  res.json({
    users: one('SELECT COUNT(*) v FROM users'), banned: one('SELECT COUNT(*) v FROM users WHERE banned=1'),
    premiumActive: one('SELECT COUNT(*) v FROM users WHERE plan>0 AND plan_exp>?', Date.now()),
    flaggedUsers: one('SELECT COUNT(*) v FROM users WHERE flags>0'),
    wtcPaidOut: one("SELECT COALESCE(SUM(amount),0) v FROM ledger WHERE amount>0 AND kind!='adjust'"),
    wtcInCirculation: one('SELECT COALESCE(SUM(balance),0) v FROM users'),
    tasksCompletedToday: one("SELECT COUNT(*) v FROM ledger WHERE kind='task' AND created_at>=?", R.dayStart()),
    pendingUpgrades: one("SELECT COUNT(*) v FROM upgrades WHERE status='pending'"), paymentsToReview: one("SELECT COUNT(*) v FROM payments WHERE status='review'"), openTickets: one('SELECT COUNT(*) v FROM tickets WHERE resolved=0'),
    tokenPrice: S.tokenPrice(),
  });
});

router.get('/charts', (req, res) => {
  const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }), req.query);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const from = R.dayStart(Date.now() - i * R.MS_DAY), to = from + R.MS_DAY;
    const one = (sql) => db.prepare(sql).get(from, to).v;
    out.push({
      date: R.dayKey(from),
      signups: one('SELECT COUNT(*) v FROM users WHERE created_at>=? AND created_at<?'),
      tasks: one("SELECT COUNT(*) v FROM ledger WHERE kind='task' AND created_at>=? AND created_at<?"),
      wtcIssued: one("SELECT COALESCE(SUM(amount),0) v FROM ledger WHERE amount>0 AND kind!='adjust' AND created_at>=? AND created_at<?"),
    });
  }
  res.json({ days: out });
});

router.get('/export/users.csv', (req, res) => {
  const rows = db.prepare('SELECT name, email, role, balance, lifetime, plan, plan_exp, flags, banned, created_at FROM users ORDER BY id').all();
  const head = ['name', 'email', 'role', 'balance', 'lifetime', 'plan', 'flags', 'banned', 'joined'];
  const lines = rows.map((u) => [u.name, u.email, u.role, u.balance, u.lifetime, R.PLANS[R.activePlan(u)].name, u.flags, u.banned, R.dayKey(u.created_at)].map(csvCell).join(','));
  res.type('text/csv').attachment('users.csv').send([head.join(','), ...lines].join('\n'));
});


// ---------- user detail ----------
const ledgerPage = (userId, before) =>
  db.prepare(`SELECT id, amount, kind, note, created_at createdAt FROM ledger WHERE user_id=? ${before ? 'AND id<?' : ''} ORDER BY id DESC LIMIT 50`)
    .all(...[userId, ...(before ? [before] : [])]);

router.get('/users/:id', (req, res) => {
  const u = S.getUser(id(req));
  if (!u) throw new HttpError(404, 'User not found');
  const lvl = R.levelFor(u.lifetime), plan = R.activePlan(u);
  const sessions = db.prepare(`SELECT s.day, s.status, s.started_at startedAt, s.finished_at finishedAt, t.title, t.type
    FROM sessions s JOIN tasks t ON t.id=s.task_id WHERE s.user_id=? ORDER BY s.id DESC LIMIT 40`).all(u.id);
  const inviter = u.referred_by ? db.prepare('SELECT id, name, email FROM users WHERE id=?').get(u.referred_by) : null;
  res.json({
    user: {
      id: u.id, email: u.email, name: u.name, role: u.role, banned: !!u.banned, emailVerified: !!u.email_verified,
      balance: u.balance, balanceUsdt: R.toUsdt(u.balance, S.tokenPrice()), lifetime: u.lifetime, streak: u.streak, flags: u.flags,
      level: lvl.name, plan: R.PLANS[plan].name, planExpiresAt: plan ? u.plan_exp : null, signupIp: u.signup_ip, createdAt: u.created_at,
      lastActivity: (db.prepare('SELECT MAX(created_at) v FROM ledger WHERE user_id=?').get(u.id).v) || null,
    },
    ledger: ledgerPage(u.id),
    sessions,
    invitedBy: inviter,
    referrals: db.prepare('SELECT id, name, email, referral_paid active, banned, created_at createdAt FROM users WHERE referred_by=? ORDER BY id DESC').all(u.id)
      .map((f) => ({ ...f, active: !!f.active, banned: !!f.banned })),
    upgrades: db.prepare('SELECT id, plan, reference, status, created_at createdAt FROM upgrades WHERE user_id=? ORDER BY id DESC').all(u.id)
      .map((g) => ({ ...g, planName: R.PLANS[g.plan].name })),
    tickets: db.prepare('SELECT id, message, resolved, created_at createdAt FROM tickets WHERE user_id=? ORDER BY id DESC LIMIT 20').all(u.id),
    payments: db.prepare('SELECT reference, plan, amount_minor amountMinor, currency, status, channel, created_at createdAt, paid_at paidAt FROM payments WHERE user_id=? ORDER BY id DESC LIMIT 20').all(u.id)
      .map((p) => ({ ...p, planName: R.PLANS[p.plan].name })),
  });
});

router.get('/users/:id/ledger', (req, res) => {
  const { before } = parse(z.object({ before: z.coerce.number().int().optional() }), req.query);
  res.json({ ledger: ledgerPage(id(req), before) });
});

// ---------- Paystack payments ----------
router.get('/payments', (req, res) => {
  const q = parse(z.object({ status: z.enum(['all', 'pending', 'success', 'failed', 'abandoned', 'review']).default('all'), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
  const rows = db.prepare(`SELECT p.id, p.reference, p.plan, p.amount_minor amountMinor, p.currency, p.status, p.channel, p.created_at createdAt, p.paid_at paidAt, u.id userId, u.name, u.email
    FROM payments p JOIN users u ON u.id=p.user_id ${q.status === 'all' ? '' : 'WHERE p.status=?'} ORDER BY p.id DESC LIMIT ?`).all(...[...(q.status === 'all' ? [] : [q.status]), q.limit]);
  const totals = db.prepare("SELECT currency, COUNT(*) n, COALESCE(SUM(amount_minor),0) minor FROM payments WHERE status='success' GROUP BY currency").all();
  res.json({ payments: rows.map((p) => ({ ...p, planName: R.PLANS[p.plan].name })), totals, needsReview: db.prepare("SELECT COUNT(*) c FROM payments WHERE status='review'").get().c });
});

// ---------- USDT (TRC20) orders ----------
router.get('/crypto-orders', (req, res) => {
  const q = parse(z.object({ status: z.enum(['all', 'pending', 'paid', 'review', 'expired']).default('all'), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
  const rows = db.prepare(`SELECT o.id, o.plan, o.amount_micro amountMicro, o.status, o.txid, o.created_at createdAt, o.expires_at expiresAt, o.paid_at paidAt, u.id userId, u.name, u.email
    FROM crypto_orders o JOIN users u ON u.id=o.user_id ${q.status === 'all' ? '' : 'WHERE o.status=?'} ORDER BY o.id DESC LIMIT ?`).all(...[...(q.status === 'all' ? [] : [q.status]), q.limit]);
  res.json({ orders: rows.map((o) => ({ ...o, planName: R.PLANS[o.plan].name, amount: tron.fmt(o.amountMicro) })), enabled: tron.enabled(),
    paid: db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount_micro),0) micro FROM crypto_orders WHERE status='paid'").get(), inReview: db.prepare("SELECT COUNT(*) c FROM crypto_orders WHERE status='review'").get().c });
});

// ---------- system: backups ----------
router.get('/backups', (req, res) => res.json(require('../backup').status()));
router.post('/backups/run', async (req, res) => {
  const r = await require('../backup').runBackup();
  audit(req, 'backup.run', 'system', null, r.ok ? r.file : `failed: ${r.error}`);
  if (!r.ok) throw new HttpError(500, `The backup failed: ${r.error}`);
  res.json({ ...r, status: require('../backup').status() });
});

// ---------- team: who is staff ----------
router.get('/staff', (req, res) => {
  res.json({ staff: db.prepare("SELECT id, name, email, role, totp_enabled twoFactor, created_at createdAt FROM users WHERE role IN ('admin','support') ORDER BY role, id").all().map((u) => ({ ...u, twoFactor: !!u.twoFactor })), twoFactorRequired: cfg.requireStaff2fa });
});
router.post('/staff', (req, res) => {
  const b = parse(z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(['support', 'user']) }), req.body);
  const t = db.prepare('SELECT * FROM users WHERE email=?').get(b.email);
  if (!t) throw new HttpError(404, 'No account has that email. They need to sign up in the app first.');
  if (t.role === 'admin') throw new HttpError(400, 'Admin accounts cannot be changed here');
  db.prepare('UPDATE users SET role=? WHERE id=?').run(b.role, t.id);
  S.notify(t.id, b.role === 'support' ? 'You were added to the support team.' : 'You are no longer on the support team.');
  audit(req, b.role === 'support' ? 'staff.add' : 'staff.remove', 'user', t.id, t.email);
  res.json({ ok: true });
});
router.post('/staff/:id/reset-2fa', (req, res) => {
  const t = S.getUser(id(req));
  if (!t || t.role !== 'support') throw new HttpError(404, 'Support person not found');
  db.transaction(() => { db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_last_step=0 WHERE id=?').run(t.id); db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(t.id); })();
  audit(req, 'staff.reset2fa', 'user', t.id, t.email);
  res.json({ ok: true });
});

// ---------- plans that are about to end ----------
router.get('/expiring', (req, res) => {
  const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(60).default(7) }), req.query);
  const now = Date.now();
  const rows = db.prepare('SELECT id, name, email, plan, plan_exp FROM users WHERE plan>0 AND banned=0 AND plan_exp>? AND plan_exp<? ORDER BY plan_exp').all(now, now + days * R.MS_DAY);
  res.json({ days, users: rows.map((u) => ({ id: u.id, name: u.name, email: u.email, plan: R.PLANS[u.plan].name, priceUsdt: R.PLANS[u.plan].priceUsdt, expiresAt: u.plan_exp, daysLeft: Math.ceil((u.plan_exp - now) / R.MS_DAY) })),
    atRiskUsdt: rows.reduce((a, u) => a + R.PLANS[u.plan].priceUsdt, 0) });
});

// ---------- audit log ----------
router.get('/audit', (req, res) => {
  const q = parse(z.object({ before: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
  const rows = db.prepare(`SELECT a.id, a.action, a.target_type targetType, a.target_id targetId, a.detail, a.created_at createdAt, u.name adminName, u.email adminEmail
    FROM audit_log a JOIN users u ON u.id=a.admin_id ${q.before ? 'WHERE a.id<?' : ''} ORDER BY a.id DESC LIMIT ?`).all(...[...(q.before ? [q.before] : []), q.limit]);
  res.json({ entries: rows, nextCursor: rows.length === q.limit ? rows[rows.length - 1].id : null });
});

// ---------- announcements ----------
const AUDIENCE = {
  all: 'banned=0',
  premium: 'banned=0 AND plan>0 AND plan_exp>?',
  free: 'banned=0 AND NOT (plan>0 AND plan_exp>?)',
};
const audienceArgs = (a) => (a === 'all' ? [] : [Date.now()]);
const countAudience = (a) => db.prepare(`SELECT COUNT(*) c FROM users WHERE ${AUDIENCE[a]}`).get(...audienceArgs(a)).c;

router.get('/broadcasts', (req, res) => {
  res.json({
    counts: { all: countAudience('all'), premium: countAudience('premium'), free: countAudience('free') },
    history: db.prepare(`SELECT b.id, b.message, b.audience, b.recipients, b.created_at createdAt, u.name adminName
      FROM broadcasts b JOIN users u ON u.id=b.admin_id ORDER BY b.id DESC LIMIT 20`).all(),
  });
});

router.post('/broadcasts', (req, res) => {
  const b = parse(z.object({ message: z.string().trim().min(3).max(300), audience: z.enum(['all', 'premium', 'free']), push: z.boolean().default(false) }), req.body);
  let ids = [];
  const sent = db.transaction(() => {
    ids = db.prepare(`SELECT id FROM users WHERE ${AUDIENCE[b.audience]}`).all(...audienceArgs(b.audience));
    for (const u of ids) S.notify(u.id, b.message);
    db.prepare('INSERT INTO broadcasts(admin_id,message,audience,recipients,created_at) VALUES (?,?,?,?,?)').run(req.user.id, b.message, b.audience, ids.length, Date.now());
    audit(req, 'broadcast.send', 'broadcast', null, `${b.audience} (${ids.length} users${b.push ? ', with phone notification' : ''}): ${b.message}`);
    return ids.length;
  })();
  // Also buzz their phones, if asked. This carries on in the background and does not hold up the answer.
  if (b.push) Promise.all(ids.map((u) => push.sendToUser(u.id, { title: 'Watchcoin', body: b.message, url: '/', tag: 'announcement' }).catch(() => 0))).catch(() => {});
  res.status(201).json({ recipients: sent });
});

// ---------- task performance ----------
router.get('/tasks/stats', (req, res) => {
  const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
  const since = Date.now() - days * R.MS_DAY;
  const rows = db.prepare(`SELECT t.id, t.title, t.type, t.premium, t.active, t.tokens, t.spent,
      COUNT(s.id) started, COALESCE(SUM(s.status='done'),0) done, COALESCE(SUM(s.status='failed'),0) failed,
      COALESCE(SUM(s.status='started'),0) unfinished, AVG(CASE WHEN s.status='done' THEN s.finished_at - s.started_at END) avgMs
    FROM tasks t LEFT JOIN sessions s ON s.task_id=t.id AND s.started_at>=? GROUP BY t.id ORDER BY t.position, t.id`).all(since);
  res.json({ days, tasks: rows.map((r) => ({
    id: r.id, title: r.title, type: r.type, premium: !!r.premium, active: !!r.active, tokens: r.tokens, spent: r.spent,
    started: r.started, done: r.done, failed: r.failed, unfinished: r.unfinished,
    completionRate: r.started ? r.done / r.started : null, wrongRate: r.started ? r.failed / r.started : null,
    avgSeconds: r.avgMs == null ? null : Math.round(r.avgMs / 1000),
  })) });
});

// ---------- fraud signals ----------
// These are signals to look at, not proof. Several people can share one network (family, school, mobile data).
router.get('/fraud', (req, res) => {
  const clusters = db.prepare("SELECT signup_ip ip, COUNT(*) n FROM users WHERE signup_ip IS NOT NULL AND signup_ip!='' GROUP BY signup_ip HAVING n>1 ORDER BY n DESC LIMIT 30").all()
    .map((c) => ({ ip: c.ip, count: c.n, users: db.prepare('SELECT id, name, email, balance, banned, flags, created_at createdAt FROM users WHERE signup_ip=? ORDER BY id').all(c.ip)
      .map((u) => ({ ...u, banned: !!u.banned })) }));
  const flagged = db.prepare('SELECT id, name, email, balance, flags, banned FROM users WHERE flags>0 ORDER BY flags DESC, id LIMIT 50').all().map((u) => ({ ...u, banned: !!u.banned }));
  const rings = db.prepare(`SELECT r.id, r.name, r.email, r.balance, COUNT(*) sameNetwork FROM users r
    JOIN users f ON f.referred_by=r.id AND f.signup_ip=r.signup_ip WHERE r.signup_ip IS NOT NULL GROUP BY r.id HAVING sameNetwork>=2 ORDER BY sameNetwork DESC LIMIT 30`).all();
  res.json({ clusters, flagged, referralRings: rings });
});

// ---------- economics: money in versus tokens paid out ----------
router.get('/economics', (req, res) => {
  const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
  const price = S.tokenPrice(), from = R.dayStart(Date.now() - (days - 1) * R.MS_DAY);
  const approved = [
    ...db.prepare("SELECT plan, decided_at t FROM upgrades WHERE status='approved' AND decided_at>=?").all(from),
    ...db.prepare("SELECT plan, paid_at t FROM payments WHERE status='success' AND paid_at>=?").all(from),
    ...db.prepare("SELECT plan, paid_at t FROM crypto_orders WHERE status='paid' AND paid_at>=?").all(from),
  ];
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const a = R.dayStart(Date.now() - i * R.MS_DAY), b = a + R.MS_DAY;
    const issued = db.prepare("SELECT COALESCE(SUM(amount),0) v FROM ledger WHERE amount>0 AND kind!='adjust' AND created_at>=? AND created_at<?").get(a, b).v;
    const revenue = approved.filter((g) => g.t >= a && g.t < b).reduce((x, g) => x + R.PLANS[g.plan].priceUsdt, 0);
    out.push({ date: R.dayKey(a), revenueUsdt: revenue, issuedWtc: issued, issuedUsdt: R.toUsdt(issued, price) });
  }
  const revenue = out.reduce((a, d) => a + d.revenueUsdt, 0), issued = out.reduce((a, d) => a + d.issuedWtc, 0);
  res.json({
    days: out, price,
    totals: { revenueUsdt: revenue, issuedWtc: issued, issuedUsdt: R.toUsdt(issued, price), netUsdt: Number((revenue - issued * price).toFixed(6)),
      premiumActive: db.prepare('SELECT COUNT(*) c FROM users WHERE plan>0 AND plan_exp>?').get(Date.now()).c, upgradesApproved: approved.length },
    bySource: db.prepare("SELECT kind, COALESCE(SUM(amount),0) wtc FROM ledger WHERE amount>0 AND kind!='adjust' AND created_at>=? GROUP BY kind ORDER BY wtc DESC").all(from),
    note: 'Revenue counts premium upgrades you approved by hand, Paystack payments, and USDT payments received, valued at each plan\'s USDT price. Tokens issued are valued at the in-app rate, not a market price.',
  });
});

module.exports = router;
