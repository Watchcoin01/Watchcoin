const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const cfg = require('../config');
const { db } = require('../db');
const R = require('../rules');
const { HttpError, parse } = require('../util');
const S = require('../services');

const router = express.Router();

// ---------- profile ----------
router.get('/me', (req, res) => res.json({ user: S.publicUser(req.user) }));

router.patch('/me', (req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(1).max(60).optional(),
    avatar: z.string().max(8).nullable().optional(),
    lang: z.enum(['en', 'fr', 'ha', 'tw']).optional(),
    onboarded: z.boolean().optional(),
  }), req.body);
  const u = req.user;
  db.prepare('UPDATE users SET name=?, avatar=?, lang=?, onboarded=? WHERE id=?').run(
    b.name ?? u.name, b.avatar === undefined ? u.avatar : b.avatar, b.lang ?? u.lang, b.onboarded === undefined ? u.onboarded : +b.onboarded, u.id);
  res.json({ user: S.publicUser(S.getUser(u.id)) });
});

router.post('/me/password', async (req, res) => {
  const b = parse(z.object({ currentPassword: z.string().min(1).max(100), newPassword: z.string().min(6).max(100) }), req.body);
  if (!(await bcrypt.compare(b.currentPassword, req.user.pass_hash))) throw new HttpError(401, 'Current password is wrong');
  db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(await bcrypt.hash(b.newPassword, 10), req.user.id);
  res.json({ ok: true });
});

router.delete('/me', async (req, res) => {
  const b = parse(z.object({ password: z.string().min(1).max(100) }), req.body);
  if (req.user.role === 'admin') throw new HttpError(403, 'Admin accounts cannot be deleted here');
  if (!(await bcrypt.compare(b.password, req.user.pass_hash))) throw new HttpError(401, 'Password is wrong');
  db.transaction(() => {
    db.prepare('UPDATE users SET referred_by=NULL WHERE referred_by=?').run(req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);
    db.prepare('DELETE FROM users WHERE id=?').run(req.user.id);
  })();
  res.json({ ok: true });
});

// ---------- notifications ----------
router.get('/notifications', (req, res) => {
  const items = db.prepare('SELECT id, message, read, created_at createdAt FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json({ notifications: items.map((n) => ({ ...n, read: !!n.read })) });
});
router.post('/notifications/read', (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

// ---------- wallet ----------
router.get('/wallet', (req, res) => {
  const { limit, before } = parse(z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50), before: z.coerce.number().int().optional(),
  }), req.query);
  const u = req.user, price = S.tokenPrice();
  const rows = db.prepare(`SELECT id, amount, kind, note, created_at createdAt FROM ledger
    WHERE user_id=? ${before ? 'AND id<?' : ''} ORDER BY id DESC LIMIT ?`).all(...[u.id, ...(before ? [before] : []), limit]);
  const today = db.prepare("SELECT COALESCE(SUM(amount),0) v FROM ledger WHERE user_id=? AND amount>0 AND kind!='adjust' AND created_at>=?").get(u.id, R.dayStart()).v;
  res.json({
    balance: u.balance, balanceUsdt: R.toUsdt(u.balance, price), price, earnedToday: today, earnedAllTime: u.lifetime,
    earnedAllTimeUsdt: R.toUsdt(u.lifetime, price), history: rows, nextCursor: rows.length === limit ? rows[rows.length - 1].id : null,
  });
});

// Not live yet: the token has not launched. The routes exist so the app can call them later.
const comingSoon = (what) => (req, res) => res.status(501).json({ error: `${what} is coming soon, once WTC launches`, comingSoon: true });
router.post('/wallet/transfer', comingSoon('Transfer'));
router.post('/wallet/convert', comingSoon('Convert'));

// ---------- referrals, leaderboard, support, launch ----------
router.get('/referrals', (req, res) => {
  const friends = db.prepare('SELECT name, referral_paid active, created_at joinedAt FROM users WHERE referred_by=? ORDER BY id DESC').all(req.user.id)
    .map((f) => ({ name: f.name, active: !!f.active, joinedAt: f.joinedAt }));
  res.json({ code: req.user.ref_code, link: `${cfg.publicUrl}/?ref=${req.user.ref_code}`, rewardPerFriend: R.BONUS.referral, friends });
});

router.get('/leaderboard', (req, res) => {
  const since = Date.now() - 7 * R.MS_DAY;
  const cte = `WITH s AS (SELECT u.id, u.name, u.avatar, COALESCE(SUM(l.amount),0) score FROM users u
    LEFT JOIN ledger l ON l.user_id=u.id AND l.amount>0 AND l.kind!='adjust' AND l.created_at>=? WHERE u.banned=0 GROUP BY u.id),
    r AS (SELECT id, name, avatar, score, RANK() OVER (ORDER BY score DESC) rank FROM s)`;
  const top = db.prepare(`${cte} SELECT name, avatar, score, rank FROM r ORDER BY rank, id LIMIT 10`).all(since);
  const me = db.prepare(`${cte} SELECT name, avatar, score, rank FROM r WHERE id=?`).get(since, req.user.id);
  res.json({ period: 'last 7 days', top, me });
});

router.post('/support', (req, res) => {
  const { message } = parse(z.object({ message: z.string().trim().min(5).max(1000) }), req.body);
  db.prepare('INSERT INTO tickets(user_id,message,created_at) VALUES (?,?,?)').run(req.user.id, message, Date.now());
  res.status(201).json({ ok: true });
});

router.get('/launch', (req, res) => {
  const { getSetting } = require('../db');
  const position = db.prepare('SELECT COUNT(*) c FROM users WHERE id<=?').get(req.user.id).c;
  res.json({ launchAt: getSetting('launch_at') || null, position, ...publicStats() });
});

function publicStats() {
  const s = db.prepare('SELECT COUNT(*) members, COALESCE(SUM(lifetime),0) totalEarned FROM users').get();
  return { members: s.members, totalEarned: s.totalEarned, price: S.tokenPrice(), launchAt: require('../db').getSetting('launch_at') || null };
}
router.publicStats = publicStats;

module.exports = router;
