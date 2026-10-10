// Checking a two-step login code (authenticator code or backup code), with a lockout after repeated mistakes.
const { db } = require('./db');
const totp = require('./totp');
const { HttpError } = require('./util');

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

// Throws on a wrong or locked code. Returns { backupUsed, backupLeft }.
// Call with a fresh user row. Pass allowBackup=false where only the phone should count.
function checkCode(user, code, { allowBackup = true } = {}) {
  if (!user.totp_enabled || !user.totp_secret) throw new HttpError(400, 'Two-step login is not on');
  if (user.mfa_locked_until > Date.now()) {
    throw new HttpError(429, 'Too many wrong codes. Try again in 15 minutes.');
  }
  const raw = String(code || '').trim();
  const step = totp.verify(totp.open(user.totp_secret), raw, user.totp_last_step);
  if (step !== null) {
    db.prepare('UPDATE users SET totp_last_step=?, mfa_fails=0 WHERE id=?').run(step, user.id);
    return { backupUsed: false, backupLeft: JSON.parse(user.backup_codes).length };
  }
  if (allowBackup && raw.length >= 10) {
    const list = JSON.parse(user.backup_codes), h = totp.hashBackup(raw), i = list.indexOf(h);
    if (i >= 0) {
      list.splice(i, 1);
      db.prepare('UPDATE users SET backup_codes=?, mfa_fails=0 WHERE id=?').run(JSON.stringify(list), user.id);
      return { backupUsed: true, backupLeft: list.length };
    }
  }
  const fails = user.mfa_fails + 1;
  if (fails >= MAX_FAILS) db.prepare('UPDATE users SET mfa_fails=0, mfa_locked_until=? WHERE id=?').run(Date.now() + LOCK_MS, user.id);
  else db.prepare('UPDATE users SET mfa_fails=? WHERE id=?').run(fails, user.id);
  throw new HttpError(401, 'That code is not right');
}

module.exports = { checkCode, MAX_FAILS };
