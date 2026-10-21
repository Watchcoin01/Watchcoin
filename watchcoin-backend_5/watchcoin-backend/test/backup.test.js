const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const PORT = 47000 + Math.floor(Math.random() * 900), HOOK = PORT + 1;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-backup-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.MAX_ACCOUNTS_PER_IP = '50';
process.env.JWT_SECRET = 'test-secret';
process.env.BACKUP_DIR = DIR;
process.env.BACKUP_KEEP = '3';
process.env.BACKUP_PASSPHRASE = 'correct horse battery staple';
process.env.BACKUP_S3_ENDPOINT = `http://127.0.0.1:${PORT}`;
process.env.BACKUP_S3_BUCKET = 'my-bucket';
process.env.BACKUP_S3_ACCESS_KEY_ID = 'AKIATEST';
process.env.BACKUP_S3_SECRET_ACCESS_KEY = 'secret';
process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${HOOK}/hook`;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createApp } = require('../src/server');
const { db } = require('../src/db');
const backup = require('../src/backup');
const { alert, resetAlerts } = require('../src/alerts');

const puts = [], hooks = [];
const fakeS3 = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { puts.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: Buffer.concat(c) }); res.statusCode = 200; res.setHeader('etag', '"abc"'); res.end(); }); });
const fakeHook = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { hooks.push(JSON.parse(Buffer.concat(c).toString())); res.end('ok'); }); });
let server, base, admin, ama;
before(() => new Promise((resolve) => { fakeS3.listen(PORT, () => fakeHook.listen(HOOK, () => { server = createApp().listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; resolve(); }); })); }));
after(() => { server.close(); fakeS3.close(); fakeHook.close(); fs.rmSync(DIR, { recursive: true, force: true }); });

async function call(method, p, { token, body } = {}) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; } return { status: res.status, body: json };
}
const signup = async (n, e) => (await call('POST', '/auth/signup', { body: { name: n, email: e, password: 'secret1' } })).body;

test('health check also proves the database answers', async () => {
  const r = await call('GET', '/health');
  assert.equal(r.status, 200); assert.equal(r.body.db, 'ok');
});

test('a backup is a real, compressed, encrypted copy of the database, and is copied to remote storage', async () => {
  admin = await signup('Boss', 'admin@test.com'); ama = await signup('Ama', 'ama@test.com');
  const r = await backup.runBackup();
  assert.equal(r.ok, true); assert.match(r.file, /^watchcoin-\d{8}-\d{6}\.db\.gz\.enc$/);
  const file = fs.readFileSync(path.join(DIR, r.file));
  assert.ok(!file.includes('ama@test.com')); // nothing readable: it is encrypted
  assert.throws(() => backup.openBackup(file, 'wrong passphrase'), /Wrong passphrase/);
  const dbBytes = backup.openBackup(file, process.env.BACKUP_PASSPHRASE);
  const copy = path.join(DIR, 'restored.db'); fs.writeFileSync(copy, dbBytes);
  const restored = new Database(copy, { readonly: true });
  assert.equal(restored.prepare('SELECT COUNT(*) c FROM users').get().c, 2);
  assert.ok(restored.prepare("SELECT email FROM users WHERE name='Ama'").get().email === 'ama@test.com');
  assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok'); restored.close();
  // the remote copy is the same bytes, uploaded with signed credentials to the right place
  assert.equal(puts.length, 1); assert.equal(puts[0].method, 'PUT');
  assert.match(puts[0].url, new RegExp(`^/my-bucket/watchcoin/${r.file.replace(/\./g, '\\.')}`));
  assert.match(puts[0].auth, /^AWS4-HMAC-SHA256 Credential=AKIATEST\//);
  assert.deepEqual(puts[0].body, file);
  assert.match(r.remote, /^s3:\/\/my-bucket\/watchcoin\//);
});

test('an unencrypted backup also opens, and old local copies are removed', async () => {
  const keep = process.env.BACKUP_PASSPHRASE;
  for (let i = 0; i < 4; i++) { await new Promise((res) => setTimeout(res, 1100)); await backup.runBackup(); } // different file names, one per second
  const files = fs.readdirSync(DIR).filter((f) => /^watchcoin-/.test(f));
  assert.equal(files.length, 3); // BACKUP_KEEP=3
  assert.equal(backup.status().history.filter((h) => h.status === 'ok').length, 5);
  const zipped = zlib.gzipSync(Buffer.from('plain'));
  assert.equal(backup.openBackup(zipped, keep).toString(), 'plain'); // a plain .gz works without the passphrase
});

test('admin sees the backup status and can run one now; others cannot', async () => {
  const s = (await call('GET', '/admin/backups', { token: admin.token })).body;
  assert.equal(s.encrypted, true); assert.equal(s.remote.configured, true); assert.equal(s.alerts, true); assert.equal(s.stale, false);
  assert.ok(s.lastOk > Date.now() - 60000);
  const run = await call('POST', '/admin/backups/run', { token: admin.token });
  assert.equal(run.status, 200); assert.equal(run.body.ok, true);
  assert.equal((await call('GET', '/admin/backups', { token: ama.token })).status, 403);
  assert.equal((await call('POST', '/admin/backups/run', { token: ama.token })).status, 403);
  const audit = (await call('GET', '/admin/audit', { token: admin.token })).body.entries;
  assert.ok(audit.some((e) => e.action === 'backup.run'));
});

test('a failed backup is recorded and raises an alert', async () => {
  resetAlerts(); hooks.length = 0;
  const bad = path.join(DIR, 'a-file-not-a-folder'); fs.writeFileSync(bad, 'x');
  const keepDir = process.env.BACKUP_DIR; require('../src/config').backupDir = bad; // the backup folder cannot be created
  const r = await backup.runBackup();
  require('../src/config').backupDir = keepDir;
  assert.equal(r.ok, false);
  assert.equal(backup.status().history[0].status, 'failed');
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(hooks.length, 1); assert.match(hooks[0].text, /^Watchcoin: The database backup failed/); assert.equal(hooks[0].text, hooks[0].content);
});

test('alerts are throttled, and server errors and stale backups are reported', async () => {
  resetAlerts(); hooks.length = 0;
  assert.equal(await alert('same', 'first'), true); assert.equal(await alert('same', 'again'), false); // not twice in a row
  assert.equal(await alert('other', 'a different problem'), true);
  assert.equal(hooks.length, 2);
  hooks.length = 0; resetAlerts();
  db.prepare("UPDATE settings SET value='1' WHERE key='last_backup_ok'").run(); // pretend the last good backup was long ago
  assert.equal(backup.status().stale, true);
  await backup.tick(); // it is overdue, so it runs one, and that fixes it
  assert.equal(backup.status().stale, false);
});
