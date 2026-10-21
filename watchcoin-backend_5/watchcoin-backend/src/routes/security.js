// Two-step login setup for staff: scan a QR code once, confirm a code, and keep ten recovery codes.
const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const cfg = require('../config');
const { db } = require('../db');
const totp = require('../totp');
const { HttpError, parse } = require('../util');
const { checkSecondFactor } = require('./auth');

const router = express.Router();
const staff = (req, res, next) => { if (req.user.role === 'user') throw new HttpError(403, 'Two-step login is for staff accounts'); next(); };
const fresh = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);

function giveCodes(userId) {
  const codes = totp.newRecoveryCodes();
  db.transaction(() => {
    db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(userId);
    for (const c of codes) db.prepare('INSERT INTO recovery_codes(user_id, code_hash) VALUES (?,?)').run(userId, totp.hashCode(c));
  })();
  return codes;
}
async function confirm(u, password, code) {
  if (!(await bcrypt.compare(password, u.pass_hash))) throw new HttpError(401, 'Your password is wrong');
  if (!checkSecondFactor(u, code)) throw new HttpError(401, 'That code is not right');
}

router.post('/me/2fa/setup', staff, (req, res) => {
  if (req.user.totp_enabled) throw new HttpError(409, 'Two-step login is already on');
  const secret = totp.newSecret();
  db.prepare('UPDATE users SET totp_secret=? WHERE id=?').run(secret, req.user.id); // not active until a code is confirmed
  res.json({ secret, uri: totp.uri(req.user.email, secret) });
});

router.post('/me/2fa/enable', staff, (req, res) => {
  const { code } = parse(z.object({ code: z.string().trim().min(6).max(8) }), req.body);
  const u = fresh(req.user.id);
  if (u.totp_enabled) throw new HttpError(409, 'Two-step login is already on');
  const s = totp.verify(u.totp_secret, code);
  if (!s) throw new HttpError(400, 'That code is not right. Check that the clock on your phone is correct.');
  db.prepare('UPDATE users SET totp_enabled=1, totp_last_step=? WHERE id=?').run(s, u.id);
  res.json({ ok: true, recoveryCodes: giveCodes(u.id) }); // shown once
});

router.post('/me/2fa/recovery-codes', staff, async (req, res) => {
  const b = parse(z.object({ password: z.string().max(100), code: z.string().trim().min(6).max(20) }), req.body);
  const u = fresh(req.user.id);
  if (!u.totp_enabled) throw new HttpError(400, 'Turn on two-step login first');
  await confirm(u, b.password, b.code);
  res.json({ recoveryCodes: giveCodes(u.id) });
});

router.post('/me/2fa/disable', staff, async (req, res) => {
  const b = parse(z.object({ password: z.string().max(100), code: z.string().trim().min(6).max(20) }), req.body);
  if (cfg.requireStaff2fa) throw new HttpError(403, 'Two-step login is required for staff');
  const u = fresh(req.user.id);
  if (!u.totp_enabled) throw new HttpError(400, 'Two-step login is not on');
  await confirm(u, b.password, b.code);
  db.transaction(() => { db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_last_step=0 WHERE id=?').run(u.id); db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(u.id); })();
  res.json({ ok: true });
});

router.get('/me/2fa', staff, (req, res) => {
  res.json({ enabled: !!req.user.totp_enabled, required: cfg.requireStaff2fa, recoveryCodesLeft: db.prepare('SELECT COUNT(*) c FROM recovery_codes WHERE user_id=? AND used_at IS NULL').get(req.user.id).c });
});

module.exports = router;
