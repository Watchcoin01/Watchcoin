// Everything that earns tokens. All checks happen here on the server, so the app cannot be tricked.
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const cfg = require('../config');
const { db } = require('../db');
const R = require('../rules');
const { HttpError, parse } = require('../util');
const S = require('../services');

const router = express.Router();

const idParam = (req) => parse(z.coerce.number().int().positive(), req.params.id);

// ---------- today's tasks ----------
router.get('/tasks', (req, res) => {
  const u = req.user;
  const list = S.availableTasks(u);
  const sess = new Map(db.prepare('SELECT task_id, status FROM sessions WHERE user_id=? AND day=?').all(u.id, R.dayKey()).map((s) => [s.task_id, s.status]));
  const tasks = list.map((t) => {
    const st = sess.get(t.id);
    const closed = t.budget > 0 && t.spent >= t.budget;
    return S.taskPublic(t, u, st === 'done' ? 'done' : st === 'failed' ? 'missed' : closed ? 'closed' : 'open');
  });
  const done = tasks.filter((t) => t.status === 'done').length;
  res.json({
    tasks, done, total: tasks.length,
    potentialLeft: tasks.filter((t) => t.status === 'open').reduce((a, t) => a + t.reward, 0),
    allDoneBonus: R.BONUS.allDone,
    resetsAt: R.dayStart() + R.MS_DAY,
  });
});

router.post('/tasks/:id/start', (req, res) => {
  const u = req.user;
  if (cfg.requireEmailVerification && !u.email_verified) throw new HttpError(403, 'Verify your email to start earning');
  const t = S.availableTasks(u).find((x) => x.id === idParam(req));
  if (!t) throw new HttpError(404, 'This task is not available on your plan');
  if (t.budget > 0 && t.spent >= t.budget) throw new HttpError(409, 'This task is closed');

  const recent = db.prepare("SELECT COUNT(*) c FROM sessions WHERE user_id=? AND status='done' AND finished_at>?").get(u.id, Date.now() - 3600000).c;
  if (recent >= R.MAX_TASKS_PER_HOUR) throw new HttpError(429, `Slow down. You can finish ${R.MAX_TASKS_PER_HOUR} tasks per hour.`);

  const day = R.dayKey();
  const existing = db.prepare('SELECT * FROM sessions WHERE user_id=? AND task_id=? AND day=?').get(u.id, t.id, day);
  if (existing && existing.status !== 'started') throw new HttpError(409, existing.status === 'done' ? 'You already finished this task today' : 'You missed this task today');
  const now = Date.now();
  if (existing) db.prepare('UPDATE sessions SET started_at=? WHERE id=?').run(now, existing.id);
  else db.prepare("INSERT INTO sessions(user_id,task_id,day,status,started_at) VALUES (?,?,?,'started',?)").run(u.id, t.id, day, now);

  res.json({
    taskId: t.id, type: t.type, secs: t.secs, url: t.url, startedAt: now,
    question: t.question || null, options: t.question ? JSON.parse(t.options) : [],
  });
});

router.post('/tasks/:id/complete', (req, res) => {
  const u = req.user;
  const { answer } = parse(z.object({ answer: z.number().int().min(0).max(20).optional() }), req.body || {});
  const t = db.prepare('SELECT * FROM tasks WHERE id=? AND active=1').get(idParam(req));
  if (!t) throw new HttpError(404, 'Task not found');
  const day = R.dayKey();
  const sess = db.prepare('SELECT * FROM sessions WHERE user_id=? AND task_id=? AND day=?').get(u.id, t.id, day);
  if (!sess) throw new HttpError(409, 'Start the task first');
  if (sess.status !== 'started') throw new HttpError(409, 'This task is already finished');

  // Checked again here, not only at start: otherwise many tasks could be started at once and finished together,
  // a plan could expire mid-task, or a budget could be overspent by people who started before it ran out.
  const recent = db.prepare("SELECT COUNT(*) c FROM sessions WHERE user_id=? AND status='done' AND finished_at>?").get(u.id, Date.now() - 3600000).c;
  if (recent >= R.MAX_TASKS_PER_HOUR) throw new HttpError(429, `Slow down. You can finish ${R.MAX_TASKS_PER_HOUR} tasks per hour.`);
  if (!S.availableTasks(u).some((x) => x.id === t.id)) throw new HttpError(403, 'This task is not available on your plan');
  if (t.budget > 0 && t.spent >= t.budget) throw new HttpError(409, 'This task is closed');

  const elapsed = Date.now() - sess.started_at;
  const needed = t.secs * 1000;
  if (t.type !== 'poll' && elapsed < needed - 500) {
    throw new HttpError(400, 'Too early. Keep watching.', { waitMs: needed - elapsed });
  }

  // Questions: wrong answers, and answers sent too fast to have been read, forfeit the task for the day.
  let correct = true;
  if (t.question) {
    const opts = JSON.parse(t.options);
    if (!Number.isInteger(answer) || answer >= opts.length) throw new HttpError(400, 'Choose one of the answers');
    const bot = t.type !== 'poll' && elapsed - needed < R.MIN_QUIZ_READ_MS;
    if (bot) db.prepare('UPDATE users SET flags = flags + 1 WHERE id=?').run(u.id);
    correct = !bot && (t.type === 'poll' || answer === t.answer);
  }
  if (!correct) {
    db.prepare("UPDATE sessions SET status='failed', finished_at=? WHERE id=?").run(Date.now(), sess.id);
    return res.json({ ok: false, reason: 'wrong_answer', message: 'Wrong answer. No tokens for this task today.' });
  }

  const result = db.transaction(() => {
    const fresh = S.getUser(u.id);
    const reward = R.rewardFor(t, fresh);
    const bonuses = [];
    db.prepare("UPDATE sessions SET status='done', finished_at=? WHERE id=?").run(Date.now(), sess.id);
    db.prepare('UPDATE tasks SET spent = spent + ?, completed = completed + 1 WHERE id=?').run(reward, t.id);
    S.credit(u.id, reward, 'task', t.title);

    // Referral: the inviter is paid once, when the friend finishes their first task.
    if (fresh.referred_by && !fresh.referral_paid) {
      db.prepare('UPDATE users SET referral_paid=1 WHERE id=?').run(u.id);
      S.credit(fresh.referred_by, R.BONUS.referral, 'referral', `${fresh.name} finished their first task`);
      S.notify(fresh.referred_by, `${fresh.name} joined with your code. +${R.BONUS.referral} WTC`);
      S.checkAchievements(fresh.referred_by);
    }

    // Finishing every task available today pays a one-time daily bonus.
    const list = S.availableTasks(fresh);
    const doneCount = db.prepare(`SELECT COUNT(*) c FROM sessions WHERE user_id=? AND day=? AND status='done'
      AND task_id IN (${list.map(() => '?').join(',')})`).get(u.id, day, ...list.map((x) => x.id)).c;
    if (list.length && doneCount >= list.length && fresh.all_done_day !== day) {
      db.prepare('UPDATE users SET all_done_day=? WHERE id=?').run(day, u.id);
      S.credit(u.id, R.BONUS.allDone, 'bonus', 'All tasks done bonus');
      S.notify(u.id, `All tasks done. +${R.BONUS.allDone} WTC bonus`);
      bonuses.push({ kind: 'all_done', amount: R.BONUS.allDone });
    }
    const achievements = S.checkAchievements(u.id);
    return { reward, bonuses, achievements };
  })();

  res.json({ ok: true, ...result, balance: S.getUser(u.id).balance });
});

// ---------- streak and spin ----------
const yesterday = () => R.dayKey(Date.now() - R.MS_DAY);

function rewardsState(u) {
  const day = R.dayKey();
  const claimedToday = u.last_claim === day;
  const nextStreak = claimedToday ? u.streak : u.last_claim === yesterday() ? u.streak + 1 : 1;
  const doneToday = db.prepare("SELECT COUNT(*) c FROM sessions WHERE user_id=? AND day=? AND status='done'").get(u.id, day).c;
  return {
    streak: { current: u.streak, claimedToday, next: nextStreak, nextAmount: R.BONUS.streakBase * Math.min(nextStreak, R.BONUS.streakCapDays) },
    spin: { prizes: R.SPIN_PRIZES, unlocked: doneToday >= 1 && u.spin_day !== day, spunToday: u.spin_day === day,
      prize: u.spin_day === day ? u.spin_prize : null, index: u.spin_day === day ? u.spin_index : null, needs: doneToday >= 1 ? null : 'Complete a task to unlock' },
  };
}

router.get('/rewards', (req, res) => res.json(rewardsState(req.user)));

router.post('/rewards/streak/claim', (req, res) => {
  const u = req.user, day = R.dayKey();
  if (u.last_claim === day) throw new HttpError(409, 'You already claimed today');
  const streak = u.last_claim === yesterday() ? u.streak + 1 : 1;
  const amount = R.BONUS.streakBase * Math.min(streak, R.BONUS.streakCapDays);
  db.transaction(() => {
    db.prepare('UPDATE users SET streak=?, last_claim=? WHERE id=?').run(streak, day, u.id);
    S.credit(u.id, amount, 'streak', `Day ${streak} streak bonus`);
    S.checkAchievements(u.id);
  })();
  res.json({ amount, streak, balance: S.getUser(u.id).balance });
});

router.post('/rewards/spin', (req, res) => {
  const u = req.user, day = R.dayKey();
  const st = rewardsState(u).spin;
  if (st.spunToday) throw new HttpError(409, 'You already spun today');
  if (!st.unlocked) throw new HttpError(403, 'Complete a task to unlock the wheel');
  const index = crypto.randomInt(R.SPIN_PRIZES.length);
  const prize = R.SPIN_PRIZES[index];
  db.transaction(() => {
    db.prepare('UPDATE users SET spin_day=?, spin_prize=?, spin_index=? WHERE id=?').run(day, prize, index, u.id);
    S.credit(u.id, prize, 'spin', 'Daily spin');
    S.checkAchievements(u.id);
  })();
  res.json({ index, prize, prizes: R.SPIN_PRIZES, balance: S.getUser(u.id).balance });
});

// ---------- weekly challenges and achievements ----------
router.get('/challenges', (req, res) => {
  const prog = S.weekProgress(req.user.id), ws = R.weekStart();
  const claimed = new Set(db.prepare('SELECT challenge_id id FROM challenge_claims WHERE user_id=? AND week_start=?').all(req.user.id, ws).map((r) => r.id));
  res.json({
    weekStart: ws, resetsAt: ws + 7 * R.MS_DAY,
    challenges: R.CHALLENGES.map((c) => ({ id: c.id, title: c.title, target: c.target, reward: c.reward,
      progress: Math.min(prog[c.metric], c.target), claimed: claimed.has(c.id), claimable: !claimed.has(c.id) && prog[c.metric] >= c.target })),
  });
});

router.post('/challenges/:id/claim', (req, res) => {
  const cid = parse(z.coerce.number().int().min(0), req.params.id);
  const c = R.CHALLENGES.find((x) => x.id === cid);
  if (!c) throw new HttpError(404, 'Challenge not found');
  const ws = R.weekStart();
  if (S.weekProgress(req.user.id)[c.metric] < c.target) throw new HttpError(400, 'You have not reached this goal yet');
  try {
    db.transaction(() => {
      db.prepare('INSERT INTO challenge_claims(user_id,week_start,challenge_id) VALUES (?,?,?)').run(req.user.id, ws, c.id);
      S.credit(req.user.id, c.reward, 'challenge', c.title);
    })();
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) throw new HttpError(409, 'Already claimed this week');
    throw e;
  }
  res.json({ reward: c.reward, balance: S.getUser(req.user.id).balance });
});

router.get('/achievements', (req, res) => {
  db.transaction(() => S.checkAchievements(req.user.id))();
  const have = new Map(db.prepare('SELECT key, unlocked_at t FROM achievements WHERE user_id=?').all(req.user.id).map((r) => [r.key, r.t]));
  res.json({ achievements: R.ACHIEVEMENTS.map((a) => ({ ...a, unlocked: have.has(a.key), unlockedAt: have.get(a.key) || null })) });
});

module.exports = router;
