const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { z } = require('zod');
const cfg = require('../config');
const { db } = require('../db');
const { HttpError, parse, code } = require('../util');
const { signToken, auth } = require('../middleware');
const { publicUser, notify, getUser } = require('../services');
const mailer = require('../mailer');

const router = express.Router();
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // keeps login timing the same for unknown emails

const email = z.string().trim().toLowerCase().email().max(120);
const password = z.string().min(6, 'at least 6 characters').max(100);

router.post('/signup', async (req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(1).max(60), email, password, inviteCode: z.string().trim().max(12).optional(),
  }), req.body);

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(b.email)) throw new HttpError(409, 'An account with this email already exists');
  const sameIp = db.prepare('SELECT COUNT(*) c FROM users WHERE signup_ip = ?').get(req.ip).c;
  if (sameIp >= cfg.maxAccountsPerIp) throw new HttpError(429, 'Too many accounts were created from this network');

  const inviter = b.inviteCode ? db.prepare('SELECT id FROM users WHERE ref_code = ?').get(b.inviteCode.toUpperCase()) : null;
  const recoveryCode = code(8);
  let refCode = code(6);
  while (db.prepare('SELECT 1 FROM users WHERE ref_code = ?').get(refCode)) refCode = code(6);
  const verifyToken = crypto.randomBytes(24).toString('hex');

  const info = db.prepare(`INSERT INTO users(email,name,pass_hash,recovery_hash,role,ref_code,referred_by,verify_token,signup_ip,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    b.email, b.name, await bcrypt.hash(b.password, 10), await bcrypt.hash(recoveryCode, 10),
    cfg.adminEmail && b.email === cfg.adminEmail ? 'admin' : 'user', refCode, inviter ? inviter.id : null,
    verifyToken, req.ip, Date.now());
  const user = getUser(info.lastInsertRowid);
  notify(user.id, 'Welcome! Save your recovery code. It resets your password.');
  mailer.sendVerification(user.email, verifyToken).catch(() => {});
  res.status(201).json({ token: signToken(user.id), user: publicUser(user), recoveryCode });
});

router.post('/login', async (req, res) => {
  const b = parse(z.object({ email, password: z.string().min(1).max(100) }), req.body);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(b.email);
  const ok = await bcrypt.compare(b.password, u ? u.pass_hash : DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, 'Email or password is wrong');
  if (u.banned) throw new HttpError(403, 'This account is suspended');
  res.json({ token: signToken(u.id), user: publicUser(u) });
});

// Forgot password: the recovery code shown at signup proves ownership. A fresh code is issued afterwards.
router.post('/reset-password', async (req, res) => {
  const b = parse(z.object({ email, recoveryCode: z.string().trim().toUpperCase().min(4).max(20), newPassword: password }), req.body);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(b.email);
  const ok = await bcrypt.compare(b.recoveryCode, u ? u.recovery_hash : DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, 'Email or recovery code is wrong');
  const recoveryCode = code(8);
  db.prepare('UPDATE users SET pass_hash = ?, recovery_hash = ? WHERE id = ?')
    .run(await bcrypt.hash(b.newPassword, 10), await bcrypt.hash(recoveryCode, 10), u.id);
  res.json({ token: signToken(u.id), recoveryCode });
});

router.post('/verify-email', (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(10).max(100) }), req.body);
  const u = db.prepare('SELECT id FROM users WHERE verify_token = ?').get(token);
  if (!u) throw new HttpError(400, 'This verification link is not valid');
  db.prepare('UPDATE users SET email_verified = 1, verify_token = NULL WHERE id = ?').run(u.id);
  res.json({ ok: true });
});

router.post('/resend-verification', auth, async (req, res) => {
  if (req.user.email_verified) return res.json({ ok: true, alreadyVerified: true });
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE users SET verify_token = ? WHERE id = ?').run(token, req.user.id);
  await mailer.sendVerification(req.user.email, token);
  res.json({ ok: true });
});

module.exports = router;
