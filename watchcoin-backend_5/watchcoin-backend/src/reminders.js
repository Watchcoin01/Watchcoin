// Things we tell people on a schedule: a plan that is running out, tasks waiting, a streak about to end.
// Each one is sent at most once, by in-app notice, phone notification, and email (where the person has not turned it off).
const cfg = require('./config');
const { db } = require('./db');
const R = require('./rules');
const S = require('./services');
const push = require('./push');
const mailer = require('./mailer');
const { alert } = require('./alerts');

const DAY = R.MS_DAY;
const fmtDate = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// 3 days before, 1 day before, and just after a paid plan ends. Each is sent once for each time a plan runs.
async function runPlanReminders(now = Date.now()) {
  const users = db.prepare("SELECT * FROM users WHERE plan > 0 AND banned=0 AND plan_exp > ? AND plan_exp < ?").all(now - 2 * DAY, now + 3 * DAY);
  let sent = 0;
  for (const u of users) {
    const left = u.plan_exp - now, name = R.PLANS[u.plan].name, tasks = R.PLANS[u.plan].tasksPerDay;
    let stage, title, body;
    if (left <= 0) { stage = 'ended'; title = `Your ${name} plan has ended`; body = `You are back to ${R.PLANS[0].tasksPerDay} tasks a day. Renew any time to get ${tasks} a day again.`; }
    else if (left <= DAY) { stage = 'd1'; title = `Your ${name} plan ends within a day`; body = `Renew now to keep ${tasks} tasks a day without a break.`; }
    else { stage = 'd3'; title = `Your ${name} plan ends in ${Math.ceil(left / DAY)} days`; body = `It ends on ${fmtDate(u.plan_exp)}. Renew to keep ${tasks} tasks a day.`; }
    // one notice per stage, per time the plan ran
    if (!db.prepare('INSERT OR IGNORE INTO plan_notices(user_id,plan_exp,stage,sent_at) VALUES (?,?,?,?)').run(u.id, u.plan_exp, stage, now).changes) continue;
    sent++;
    const prefs = push.prefsOf(u);
    S.notify(u.id, `${title}. ${body}`);
    if (prefs.push_plan) await push.sendToUser(u.id, { title, body, url: '/', tag: 'plan' }).catch(() => {});
    if (prefs.email_plan) await mailer.send(u.email, title, `Hi ${u.name},\n\n${body}\n\nOpen Watchcoin to renew: ${cfg.frontendUrl}/\n\nYou can turn these emails off in the Me tab of the app.`);
  }
  return sent;
}

const hourNow = (now) => new Date(now + cfg.tzOffsetMin * 60000).getUTCHours();
// A reminder is sent once a day, any time inside a few hours after its hour, so a restart does not lose it.
const inWindow = (now, hour, span) => { const h = hourNow(now); return h >= hour && h < hour + span; };
const once = (userId, kind, day) => db.prepare('INSERT OR IGNORE INTO push_log(user_id,day,kind) VALUES (?,?,?)').run(userId, day, kind).changes > 0;

async function runDailyPushes(now = Date.now()) {
  const day = R.dayKey(now);
  const subbed = db.prepare('SELECT DISTINCT user_id FROM push_subscriptions').all().map((r) => r.user_id);
  let sent = 0;
  for (const id of subbed) {
    const u = S.getUser(id); if (!u || u.banned) continue;
    const prefs = push.prefsOf(u);
    if (prefs.push_tasks && inWindow(now, cfg.pushTasksHour, 6)) {
      const list = S.availableTasks(u, day);
      const done = db.prepare("SELECT COUNT(*) c FROM sessions WHERE user_id=? AND day=? AND status='done'").get(u.id, day).c;
      if (list.length && !done && once(u.id, 'tasks', day)) {
        const up = list.reduce((a, t) => a + R.rewardFor(t, u), 0);
        sent += await push.sendToUser(u.id, { title: 'Your tasks for today are ready', body: `${list.length} tasks are waiting. You can earn up to ${up} WTC today.`, url: '/', tag: 'tasks' });
      }
    }
    if (prefs.push_streak && inWindow(now, cfg.pushStreakHour, 4) && u.streak >= 2 && u.last_claim !== day && once(u.id, 'streak', day)) {
      sent += await push.sendToUser(u.id, { title: `Your ${u.streak}-day streak ends tonight`, body: 'Open Watchcoin and claim today\'s bonus to keep it going.', url: '/', tag: 'streak' });
    }
  }
  return sent;
}

function start() {
  const tick = () => runPlanReminders().then(() => runDailyPushes()).catch((e) => alert('reminders', `Sending reminders failed: ${e.message}`, { everyMs: 6 * 3600000 }));
  setTimeout(tick, 2 * 60000).unref(); setInterval(tick, 30 * 60000).unref();
}

module.exports = { runPlanReminders, runDailyPushes, start };
