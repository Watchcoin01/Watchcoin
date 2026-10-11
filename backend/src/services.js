const { db, getSetting } = require('./db');
const R = require('./rules');
const { rank } = require('./roles');

const tokenPrice = () => Number(getSetting('token_price', '0.005301'));

// Premium plan prices in USDT. The owner can change them in the dashboard (Settings); until then the starting prices
// from rules.js apply. Stored as JSON like {"1":5,"2":15,"3":30}.
function planPrices() {
  let saved = {};
  try { saved = JSON.parse(getSetting('plan_prices', '{}')) || {}; } catch { /* use the defaults */ }
  return R.PLANS.map((p) => {
    const v = Number(saved[p.id]);
    return p.id > 0 && v > 0 ? v : p.priceUsdt;
  });
}
const planPrice = (id) => planPrices()[id];
// The plans as users and staff see them, with the current price filled in.
const plansNow = () => { const pr = planPrices(); return R.PLANS.map((p) => ({ ...p, priceUsdt: pr[p.id] })); };

// Every balance change goes through here so the ledger and the balance never disagree.
// Call it inside db.transaction() together with the other writes that belong to the same action.
function credit(userId, amount, kind, note = '') {
  const counts = amount > 0 && kind !== 'adjust' ? amount : 0;
  db.prepare('UPDATE users SET balance = balance + ?, lifetime = lifetime + ? WHERE id = ?').run(amount, counts, userId);
  db.prepare('INSERT INTO ledger(user_id, amount, kind, note, created_at) VALUES (?,?,?,?,?)').run(userId, amount, kind, note, Date.now());
}

function notify(userId, message) {
  db.prepare('INSERT INTO notifications(user_id, message, created_at) VALUES (?,?,?)').run(userId, message, Date.now());
}

const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

function publicUser(u) {
  const price = tokenPrice();
  const lvl = R.levelFor(u.lifetime);
  const plan = R.activePlan(u);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(u.id).c;
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, avatar: u.avatar, lang: u.lang, country: u.country || null,
    onboarded: !!u.onboarded, emailVerified: !!u.email_verified, refCode: u.ref_code,
    balance: u.balance, balanceUsdt: R.toUsdt(u.balance, price), lifetime: u.lifetime,
    level: { name: lvl.name, boost: lvl.boost, next: lvl.next ? { name: lvl.next.name, remaining: lvl.next.min - u.lifetime } : null },
    plan: { id: plan, name: R.PLANS[plan].name, tasksPerDay: R.PLANS[plan].tasksPerDay, expiresAt: plan ? u.plan_exp : null },
    streak: u.streak, unreadNotifications: unread, createdAt: u.created_at,
    twoFactor: !!u.totp_enabled, staff: rank(u.role) > 0,
  };
}

// Every change made by staff is written here, so you can always see who did what and when.
function audit(actorId, action, type = '', targetId = null, detail = '') {
  db.prepare('INSERT INTO audit_log(admin_id,action,target_type,target_id,detail,created_at) VALUES (?,?,?,?,?,?)')
    .run(actorId, action, type, targetId, String(detail).slice(0, 300), Date.now());
}

// Turns on a premium plan for PLAN_DAYS. Call inside a transaction.
// Same plan still active: the new days are added on top.
// Moving up from a cheaper plan: the unused value of the old plan becomes extra days on the new one.
function activatePlan(userId, plan) {
  const u = getUser(userId), now = Date.now(), cur = R.activePlan(u);
  let start = now;
  if (cur === plan) start = u.plan_exp;
  else if (cur > 0) {
    const leftMs = u.plan_exp - now, oldPrice = planPrice(cur), newPrice = planPrice(plan);
    if (newPrice > 0) start = now + Math.floor(leftMs * oldPrice / newPrice);
  }
  const exp = start + R.PLAN_DAYS * R.MS_DAY;
  db.prepare('UPDATE users SET plan=?, plan_exp=? WHERE id=?').run(plan, exp, userId);
  notify(userId, `Your ${R.PLANS[plan].name} plan is active until ${new Date(exp).toISOString().slice(0, 10)}. You now get ${R.PLANS[plan].tasksPerDay} tasks a day.`);
  return exp;
}

// The tasks this user can see today: premium-only tasks need an active plan, and the plan caps the count.
function availableTasks(u) {
  const plan = R.activePlan(u);
  return db.prepare('SELECT * FROM tasks WHERE active = 1 AND (premium = 0 OR ? > 0) ORDER BY position, id LIMIT ?')
    .all(plan, R.PLANS[plan].tasksPerDay);
}

const taskPublic = (t, u, status) => ({
  id: t.id, type: t.type, title: t.title, cover: t.cover, premium: !!t.premium, secs: t.secs,
  reward: R.rewardFor(t, u), rewardUsdt: R.toUsdt(R.rewardFor(t, u), tokenPrice()),
  doubleUntil: t.double_until > Date.now() ? t.double_until : null,
  hasQuestion: !!t.question, status,
});

function weekProgress(userId) {
  const ws = R.weekStart();
  const one = (sql) => db.prepare(sql).get(userId, ws).v;
  return {
    tasks: one("SELECT COUNT(*) v FROM ledger WHERE user_id=? AND kind='task' AND created_at>=?"),
    streakClaims: one("SELECT COUNT(*) v FROM ledger WHERE user_id=? AND kind='streak' AND created_at>=?"),
    earned: one("SELECT COALESCE(SUM(amount),0) v FROM ledger WHERE user_id=? AND amount>0 AND kind NOT IN ('challenge','adjust') AND created_at>=?"),
  };
}

function checkAchievements(userId) {
  const u = getUser(userId);
  const tasksDone = db.prepare("SELECT COUNT(*) c FROM ledger WHERE user_id=? AND kind='task'").get(userId).c;
  const recruited = db.prepare('SELECT 1 FROM users WHERE referred_by=? AND referral_paid=1 LIMIT 1').get(userId);
  const met = {
    first: tasksDone >= 1, t10: tasksDone >= 10, s3: u.streak >= 3, s7: u.streak >= 7,
    ref: !!recruited, spin: !!u.spin_day, k1: u.lifetime >= 1000, gold: u.lifetime >= 2000,
  };
  const have = new Set(db.prepare('SELECT key FROM achievements WHERE user_id=?').all(userId).map((r) => r.key));
  const fresh = [];
  for (const a of R.ACHIEVEMENTS) {
    if (met[a.key] && !have.has(a.key)) {
      db.prepare('INSERT OR IGNORE INTO achievements(user_id,key,unlocked_at) VALUES (?,?,?)').run(userId, a.key, Date.now());
      notify(userId, `Achievement unlocked: ${a.title}`);
      fresh.push(a.key);
    }
  }
  return fresh;
}

module.exports = { audit, activatePlan, tokenPrice, planPrices, planPrice, plansNow, credit, notify, getUser, publicUser, availableTasks, taskPublic, weekProgress, checkAchievements };
