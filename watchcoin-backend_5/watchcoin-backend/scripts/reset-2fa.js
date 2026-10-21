#!/usr/bin/env node
// Locked out of the admin account (lost phone and recovery codes)? Run this on the server to switch off two-step login for it.
//   node scripts/reset-2fa.js you@example.com
// Then sign in with your password and set two-step login up again.
require('dotenv').config({ quiet: true });
const { db } = require('../src/db');
const email = (process.argv[2] || '').trim().toLowerCase();
if (!email) { console.error('Usage: node scripts/reset-2fa.js <email>'); process.exit(1); }
const u = db.prepare('SELECT id FROM users WHERE email=?').get(email);
if (!u) { console.error(`No account with the email ${email}`); process.exit(1); }
db.transaction(() => { db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_last_step=0 WHERE id=?').run(u.id); db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(u.id); })();
console.log(`Two-step login is now off for ${email}. Sign in and set it up again.`);
