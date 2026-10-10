// Account security for any logged-in user: two-step login and "log out everywhere".
// Staff must have two-step login on to use the admin area (see ADMIN_REQUIRE_2FA).
const express = require('express');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const { z } = require('zod');
const cfg = require('../config');
const { db } = require('../db');
const totp = require('../totp');
const { HttpError, parse } = require('../util');
const { signToken, revokeTokens } = require('../middleware');
const { checkCode } = require('../mfa');
const { isStaff } = require('../roles');
const S = require('../services');

const router = express.Router();
const codeBody = z.object({ code: z.string().trim().min(6).max(20) });

async function needPassword(user, pw) {
  if (!(await bcrypt.compare(String(pw || ''), user.pass_hash))) throw new HttpError(401, 'Password is wrong');
}
const logIfStaff = (u, action) => { if (isStaff(u.role)) S.audit(u.id, action, 'user', u.id); };

router.get('/me/2fa', (req, res) => {
  const u = req.user;
  res.json({ enabled: !!u.totp_enabled, backupCodesLeft: u.totp_enabled ? JSON.parse(u.backup_codes).length : 0,
    requiredForAdmin: cfg.require2fa && isStaff(u.role) });
});

// Step 1: make a new secret and show it as a QR code. Nothing changes until step 2 succeeds.
router.post('/me/2fa/setup', async (req, res) => {
  const { password } = parse(z.object({ password: z.string().min(1).max(100) }), req.body);
  await needPassword(req.user, password);
  if (req.user.totp_enabled) throw new HttpError(409, 'Two-step login is already on. Turn it off first to move it to a new phone.');
  const secret = totp.newSecret();
  db.prepare('UPDATE users SET totp_secret=?, totp_last_step=0 WHERE id=?').run(totp.seal(secret), req.user.id);
  const url = totp.otpauthUrl(secret, req.user.email);
  res.json({ secret, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
});

// Step 2: prove the phone shows the right code. Returns backup codes (shown once) and a fresh login.
router.post('/me/2fa/enable', (req, res) => {
  const { code } = parse(codeBody, req.body);
  const u = req.user;
  if (u.totp_enabled) throw new HttpError(409, 'Two-step login is already on');
  if (!u.totp_secret) throw new HttpError(400, 'Start setup first');
  const step = totp.verify(totp.open(u.totp_secret), code, 0);
  if (step === null) throw new HttpError(401, 'That code is not right. Check the time on your phone and try again.');
  const { codes, hashes } = totp.newBackupCodes();
  db.prepare('UPDATE users SET totp_enabled=1, totp_last_step=?, backup_codes=?, mfa_fails=0 WHERE id=?').run(step, JSON.stringify(hashes), u.id);
  const fresh = revokeTokens(u.id); // other devices must log in again, this time with a code
  logIfStaff(fresh, 'auth.2fa_on');
  S.notify(u.id, 'Two-step login is now on for your account.');
  res.json({ ok: true, backupCodes: codes, token: signToken(fresh), user: S.publicUser(fresh) });
});

router.post('/me/2fa/disable', async (req, res) => {
  const b = parse(z.object({ password: z.string().min(1).max(100), code: z.string().trim().min(6).max(20) }), req.body);
  await needPassword(req.user, b.password);
  checkCode(req.user, b.code);
  db.prepare("UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_last_step=0, backup_codes='[]' WHERE id=?").run(req.user.id);
  const fresh = revokeTokens(req.user.id);
  logIfStaff(fresh, 'auth.2fa_off');
  S.notify(req.user.id, 'Two-step login was turned off for your account.');
  res.json({ ok: true, token: signToken(fresh), user: S.publicUser(fresh) });
});

router.post('/me/2fa/backup-codes', (req, res) => {
  const { code } = parse(codeBody, req.body);
  checkCode(req.user, code, { allowBackup: false });
  const { codes, hashes } = totp.newBackupCodes();
  db.prepare('UPDATE users SET backup_codes=? WHERE id=?').run(JSON.stringify(hashes), req.user.id);
  logIfStaff(req.user, 'auth.backup_codes_new');
  res.json({ backupCodes: codes });
});

// Signs out every device, including this one.
router.post('/me/logout-all', (req, res) => {
  const u = revokeTokens(req.user.id);
  logIfStaff(u, 'auth.logout_all');
  res.json({ ok: true });
});

module.exports = router;
