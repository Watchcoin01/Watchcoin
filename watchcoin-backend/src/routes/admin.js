const express = require('express');
const { z } = require('zod');
const { db, getSetting, setSetting } = require('../db');
const R = require('../rules');
const { HttpError, parse, csvCell } = require('../util');
const S = require('../services');
const ps = require('../paystack');

const router = express.Router();
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
  cover: z.string().max(200000).refine((s) => s === '' || /^data:image\//.test(s), 'must be an image data URL').default(''),
  active: z.boolean().default(true),
  position: z.number().int().min(0).optional(),
});

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
  options: JSON.parse(t.options), answer: t.answer, premium: !!t.premium, active: !!t.active, cover: t.cover,
  doubleUntil: t.double_until || null, budget: t.budget, spent: t.spent, completed: t.completed, position: t.position,
});

router.get('/tasks', (req, res) => {
  res.json({ tasks: db.prepare('SELECT * FROM tasks ORDER BY position, id').all().map(toApi) });
});

router.post('/tasks', (req, res) => {
  const b = parse(taskBody, req.body);
  checkTask(b);
  const pos = db.prepare('SELECT COALESCE(MAX(position),-1)+1 p FROM tasks').get().p;
  const info = db.transaction(() => {
    const r = db.prepare(`INSERT INTO tasks(type,title,url,tokens,secs,question,options,answer,cover,premium,active,double_until,budget,position,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.type, b.title, b.url, b.tokens, b.secs, b.question, JSON.stringify(b.options), b.answer,
      b.cover, +b.premium, +b.active, b.doubleHours ? Date.now() + b.doubleHours * 3600000 : 0, b.budget, b.position ?? pos, Date.now());
    for (const u of db.prepare('SELECT id FROM users WHERE banned=0').all()) S.notify(u.id, `New task: ${b.title} (+${b.tokens} WTC)`);
    return r;
  })();
  audit(req, 'task.create', 'task', info.lastInsertRowid, `${b.title} (${b.tokens} WTC)`);
  res.status(201).json({ task: toApi(db.prepare('SELECT * FROM tasks WHERE id=?').get(info.lastInsertRowid)) });
});

router.patch('/tasks/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM tasks WHERE id=?').get(id(req));
  if (!cur) throw new HttpError(404, 'Task not found');
  // Keep only the fields the admin actually sent, so schema defaults never overwrite existing values.
  const parsed = parse(taskBody.partial(), req.body);
  const patch = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in req.body));
  const old = toApi(cur);
  const merged = { ...old, ...patch };
  const full = parse(taskBody, { ...merged, doubleHours: 0 });
  checkTask(full);
  const doubleUntil = patch.doubleHours === undefined ? cur.double_until : patch.doubleHours ? Date.now() + patch.doubleHours * 3600000 : 0;
  db.prepare(`UPDATE tasks SET type=?,title=?,url=?,tokens=?,secs=?,question=?,options=?,answer=?,cover=?,premium=?,active=?,double_until=?,budget=?,position=? WHERE id=?`)
    .run(full.type, full.title, full.url, full.tokens, full.secs, full.question, JSON.stringify(full.options), full.answer, full.cover,
      +full.premium, +full.active, doubleUntil, full.budget, full.position ?? cur.position, cur.id);
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
const settingsOut = () => ({ paymentInfo: getSetting('payment_info'), launchAt: getSetting('launch_at') || null, tokenPrice: S.tokenPrice(), paystack: ps.adminInfo() });
router.get('/settings', (req, res) => {
  res.json(settingsOut());
});
router.put('/settings', (req, res) => {
  const b = parse(z.object({
    paymentInfo: z.string().trim().min(1).max(500).optional(),
    launchAt: z.union([z.literal(''), z.string().datetime()]).nullable().optional(),
    tokenPrice: z.number().positive().max(1000).optional(),
    paystackRate: z.number().positive().max(1000000).optional(),
  }), req.body);
  if (b.paymentInfo !== undefined) setSetting('payment_info', b.paymentInfo);
  if (b.launchAt !== undefined) setSetting('launch_at', b.launchAt || '');
  if (b.tokenPrice !== undefined) setSetting('token_price', b.tokenPrice);
  if (b.paystackRate !== undefined) setSetting('paystack_rate', b.paystackRate);
  audit(req, 'settings.update', 'settings', null, Object.keys(b).map((k) => (k === 'tokenPrice' ? `tokenPrice=${b.tokenPrice}` : k === 'paystackRate' ? `paystackRate=${b.paystackRate}` : k)).join(', '));
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
  const b = parse(z.object({ message: z.string().trim().min(3).max(300), audience: z.enum(['all', 'premium', 'free']) }), req.body);
  const sent = db.transaction(() => {
    const ids = db.prepare(`SELECT id FROM users WHERE ${AUDIENCE[b.audience]}`).all(...audienceArgs(b.audience));
    for (const u of ids) S.notify(u.id, b.message);
    db.prepare('INSERT INTO broadcasts(admin_id,message,audience,recipients,created_at) VALUES (?,?,?,?,?)').run(req.user.id, b.message, b.audience, ids.length, Date.now());
    audit(req, 'broadcast.send', 'broadcast', null, `${b.audience} (${ids.length} users): ${b.message}`);
    return ids.length;
  })();
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
    note: 'Revenue counts premium upgrades you approved by hand and Paystack payments received, valued at each plan\'s USDT price. Tokens issued are valued at the in-app rate, not a market price.',
  });
});

module.exports = router;
