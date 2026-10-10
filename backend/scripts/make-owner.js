// Make an existing account the owner from the server's command line, for example in a Railway shell:
//   npm run make-owner -- you@example.com
// Use this if you can't use ADMIN_SETUP_CODE. Anyone with shell access to the server can already do anything.
const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) { console.error('Usage: npm run make-owner -- you@example.com'); process.exit(1); }
const { db } = require('../src/db');
const u = db.prepare('SELECT id, role FROM users WHERE email=?').get(email);
if (!u) { console.error(`No account with the email ${email}. Sign up in the app first.`); process.exit(1); }
const owner = db.prepare("SELECT email FROM users WHERE role='owner'").get();
if (owner && owner.email !== email && !process.argv.includes('--replace')) {
  console.error(`${owner.email} is already the owner. Add --replace to make ${email} the owner instead (the old owner becomes admin).`);
  process.exit(1);
}
db.transaction(() => {
  if (owner && owner.email !== email) db.prepare("UPDATE users SET role='admin', token_version=token_version+1 WHERE role='owner'").run();
  db.prepare("UPDATE users SET role='owner', token_version=token_version+1 WHERE id=?").run(u.id);
  db.prepare('INSERT INTO audit_log(admin_id,action,target_type,target_id,detail,created_at) VALUES (?,?,?,?,?,?)')
    .run(u.id, 'owner.claim', 'user', u.id, 'from the server command line', Date.now());
})();
console.log(`${email} is now the owner. Sign in to the admin dashboard and turn on two-step login.`);
