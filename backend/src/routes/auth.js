const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const cfg = require('../config');
const { db } = require('../db');
const { HttpError, parse, code } = require('../util');
const { ALG, signToken, signChallenge, revokeTokens, auth } = require('../middleware');
const attempts = require('../attempts');
const { publicUser, notify, getUser, audit } = require('../services');
const { isStaff } = require('../roles');
const { checkCode } = require('../mfa');
const mailer = require('../mailer');
const R = require('../rules');

const router = express.Router();
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // keeps login timing the same for unknown emails

const email = z.string().trim().toLowerCase().email().max(120);
// bcrypt only reads the first 72 bytes, so longer passwords are refused instead of being silently cut.
const password = z.string().min(8, 'at least 8 characters').max(72);

const sameText = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Who may become the owner. Only possible while there is no owner yet, so the code is effectively one-time.
// With ADMIN_SETUP_CODE set, the code is required (and the email must match ADMIN_EMAIL if that is set).
// Without it, only development builds fall back to "whoever signs up with ADMIN_EMAIL".
function mayClaimOwner(userEmail, setupCode) {
  if (db.prepare("SELECT 1 FROM users WHERE role='owner'").get()) return false;
  if (cfg.adminEmail && userEmail !== cfg.adminEmail) return false;
  if (cfg.adminSetupCode) return !!setupCode && sameText(setupCode, cfg.adminSetupCode);
  return !cfg.prod && !!cfg.adminEmail;
}

// What a successful login returns. Staff logins are written to the audit log.
function loginResult(req, u, action = 'auth.login') {
  if (isStaff(u.role)) audit(u.id, action, 'user', u.id, `from ${req.ip}`);
  return { token: signToken(u), user: publicUser(u) };
}

router.post('/signup', async (req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(1).max(60), email, password, inviteCode: z.string().trim().max(12).optional(),
    adminSetupCode: z.string().trim().max(200).optional(),
    country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
    lang: z.enum(R.LANGS).optional(),
  }), req.body);

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(b.email)) throw new HttpError(409, 'An account with this email already exists');
  const sameIp = db.prepare('SELECT COUNT(*) c FROM users WHERE signup_ip = ?').get(req.ip).c;
  if (sameIp >= cfg.maxAccountsPerIp) throw new HttpError(429, 'Too many accounts were created from this network');

  const inviter = b.inviteCode ? db.prepare('SELECT id FROM users WHERE ref_code = ?').get(b.inviteCode.toUpperCase()) : null;
  const recoveryCode = code(8);
  let refCode = code(6);
  while (db.prepare('SELECT 1 FROM users WHERE ref_code = ?').get(refCode)) refCode = code(6);
  const verifyToken = crypto.randomBytes(24).toString('hex');
  const [passHash, recoveryHash] = await Promise.all([bcrypt.hash(b.password, 10), bcrypt.hash(recoveryCode, 10)]);

  let info;
  try {
    info = db.prepare(`INSERT INTO users(email,name,pass_hash,recovery_hash,role,ref_code,referred_by,verify_token,signup_ip,created_at,country,lang)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      b.email, b.name, passHash, recoveryHash, mayClaimOwner(b.email, b.adminSetupCode) ? 'owner' : 'user', refCode,
      inviter ? inviter.id : null, verifyToken, req.ip, Date.now(), b.country || null, b.lang || 'en');
  } catch (e) {
    // Two signups for the same email at the same moment: the database keeps one.
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) throw new HttpError(409, 'An account with this email already exists');
    throw e;
  }
  const user = getUser(info.lastInsertRowid);
  if (user.role === 'owner') audit(user.id, 'owner.claim', 'user', user.id, 'at signup');
  notify(user.id, 'Welcome! Save your recovery code. It resets your password.');
  mailer.sendVerification(user.email, verifyToken).catch(() => {});
  res.status(201).json({ token: signToken(user), user: publicUser(user), recoveryCode });
});

router.post('/login', async (req, res) => {
  const b = parse(z.object({ email, password: z.string().min(1).max(100) }), req.body);
  attempts.login.check(b.email); // same answer whether or not the email exists, so it reveals nothing
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(b.email);
  const ok = await bcrypt.compare(b.password, u ? u.pass_hash : DUMMY_HASH);
  if (!u || !ok) { attempts.login.fail(b.email); throw new HttpError(401, 'Email or password is wrong'); }
  attempts.login.clear(b.email);
  if (u.banned) throw new HttpError(403, 'This account is suspended');
  // Password was right, but the account also needs a code from the authenticator app.
  if (u.totp_enabled) return res.json({ twoFactorRequired: true, challenge: signChallenge(u) });
  res.json(loginResult(req, u));
});

// Second half of a login with two-step login on: the challenge from /login plus a 6-digit or backup code.
router.post('/login/2fa', (req, res) => {
  const b = parse(z.object({ challenge: z.string().min(10).max(1000), code: z.string().trim().min(6).max(20) }), req.body);
  let p;
  try { p = jwt.verify(b.challenge, cfg.jwtSecret, { algorithms: ALG }); } catch { throw new HttpError(401, 'This login expired. Enter your password again.'); }
  if (p.typ !== 'mfa') throw new HttpError(401, 'This login expired. Enter your password again.');
  const u = getUser(p.sub);
  if (!u || (p.v || 0) !== u.token_version) throw new HttpError(401, 'This login expired. Enter your password again.');
  if (u.banned) throw new HttpError(403, 'This account is suspended');
  const r = checkCode(u, b.code);
  const out = loginResult(req, getUser(u.id), r.backupUsed ? 'auth.login_backup_code' : 'auth.login');
  res.json({ ...out, ...(r.backupUsed ? { backupCodesLeft: r.backupLeft } : {}) });
});

// Forgot password: the recovery code shown at signup proves ownership. A fresh code is issued afterwards,
// and every existing login is signed out. Accounts with two-step login must still pass it afterwards.
router.post('/reset-password', async (req, res) => {
  const b = parse(z.object({ email, recoveryCode: z.string().trim().toUpperCase().min(4).max(20), newPassword: password }), req.body);
  attempts.reset.check(b.email);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(b.email);
  const ok = await bcrypt.compare(b.recoveryCode, u ? u.recovery_hash : DUMMY_HASH);
  if (!u || !ok) { attempts.reset.fail(b.email); throw new HttpError(401, 'Email or recovery code is wrong'); }
  attempts.reset.clear(b.email);
  const recoveryCode = code(8);
  const [passHash, recoveryHash] = await Promise.all([bcrypt.hash(b.newPassword, 10), bcrypt.hash(recoveryCode, 10)]);
  db.prepare('UPDATE users SET pass_hash = ?, recovery_hash = ? WHERE id = ?').run(passHash, recoveryHash, u.id);
  const fresh = revokeTokens(u.id);
  notify(u.id, 'Your password was reset. If this was not you, contact support now.');
  if (isStaff(fresh.role)) audit(fresh.id, 'auth.password_reset', 'user', fresh.id, `from ${req.ip}`);
  if (fresh.totp_enabled) return res.json({ twoFactorRequired: true, challenge: signChallenge(fresh), recoveryCode });
  res.json({ token: signToken(fresh), recoveryCode });
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

// An existing account becomes the owner with the one-time setup code. Used by the admin dashboard.
router.post('/claim-owner', auth, (req, res) => {
  const { setupCode } = parse(z.object({ setupCode: z.string().trim().min(1).max(200) }), req.body);
  if (!cfg.adminSetupCode) throw new HttpError(400, 'ADMIN_SETUP_CODE is not set on the server');
  if (!mayClaimOwner(req.user.email, setupCode)) throw new HttpError(403, 'This code does not work for this account, or an owner already exists');
  db.prepare("UPDATE users SET role='owner' WHERE id=?").run(req.user.id);
  const u = revokeTokens(req.user.id); // the old 30-day token is replaced by a staff token
  audit(u.id, 'owner.claim', 'user', u.id, `from ${req.ip}`);
  res.json({ token: signToken(u), user: publicUser(u) });
});

module.exports = router;
