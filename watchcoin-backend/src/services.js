const { db, getSetting } = require('./db');
const R = require('./rules');

const tokenPrice = () => Number(getSetting('token_price', '0.005301'));

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
    id: u.id, email: u.email, name: u.name, role: u.role, avatar: u.avatar, lang: u.lang,
    onboarded: !!u.onboarded, emailVerified: !!u.email_verified, refCode: u.ref_code,
    balance: u.balance, balanceUsdt: R.toUsdt(u.balance, price), lifetime: u.lifetime,
    level: { name: lvl.name, boost: lvl.boost, next: lvl.next ? { name: lvl.next.name, remaining: lvl.next.min - u.lifetime } : null },
    plan: { id: plan, name: R.PLANS[plan].name, tasksPerDay: R.PLANS[plan].tasksPerDay, expiresAt: plan ? u.plan_exp : null },
    streak: u.streak, unreadNotifications: unread, createdAt: u.created_at,
  };
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

// Starts (or extends) a premium plan for 30 days. Renewing the same plan adds time on top of what is left.
function activatePlan(userId, planId) {
  const u = getUser(userId);
  const base = u.plan === planId && u.plan_exp > Date.now() ? u.plan_exp : Date.now();
  db.prepare('UPDATE users SET plan=?, plan_exp=? WHERE id=?').run(planId, base + R.PLAN_DAYS * R.MS_DAY, userId);
  notify(userId, `Your ${R.PLANS[planId].name} plan is active for ${R.PLAN_DAYS} days. You now get ${R.PLANS[planId].tasksPerDay} tasks a day.`);
}

module.exports = { activatePlan, tokenPrice, credit, notify, getUser, publicUser, availableTasks, taskPublic, weekProgress, checkAchievements };
