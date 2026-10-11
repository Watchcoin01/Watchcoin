// Switch off two-step login for one account from the server's command line, for example in a Railway shell:
//   npm run reset-2fa -- you@example.com
// Use this when the phone and the backup codes are both gone, or when the server can no longer read the saved
// secret (for example after DATA_KEY was changed). The person signs in with their password and sets
// two-step login up again. Anyone with shell access to the server can already do anything.
const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) { console.error('Usage: npm run reset-2fa -- you@example.com'); process.exit(1); }
const { db } = require('../src/db');
const u = db.prepare('SELECT id, role FROM users WHERE email=?').get(email);
if (!u) { console.error(`No account with the email ${email}.`); process.exit(1); }
db.transaction(() => {
  db.prepare("UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_last_step=0, backup_codes='[]', mfa_fails=0, mfa_locked_until=0, token_version=token_version+1 WHERE id=?").run(u.id);
  db.prepare('INSERT INTO audit_log(admin_id,action,target_type,target_id,detail,created_at) VALUES (?,?,?,?,?,?)')
    .run(u.id, 'user.reset_2fa', 'user', u.id, 'from the server command line', Date.now());
})();
console.log(`Two-step login is now off for ${email}. Sign in to the admin dashboard and turn it on again.`);
