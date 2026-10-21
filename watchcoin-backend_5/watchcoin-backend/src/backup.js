// Daily backups of the database. Each backup is a consistent copy made with SQLite's own backup, compressed, optionally
// encrypted with BACKUP_PASSPHRASE, kept on the server's disk (the newest few), and copied to S3-compatible storage
// (Amazon S3, Cloudflare R2, Backblaze B2 and others) when that is set up. Copies on the same disk do not protect you if the
// disk itself is lost, so set up the remote copy.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const cfg = require('./config');
const { db, getSetting, setSetting } = require('./db');
const { alert } = require('./alerts');

const MAGIC = Buffer.from('WCB1');
const dir = () => cfg.backupDir || path.join(cfg.dbPath === ':memory:' ? './data' : path.dirname(cfg.dbPath), 'backups');
const remoteOn = () => !!(cfg.s3.bucket && cfg.s3.accessKeyId && cfg.s3.secretAccessKey);
const stamp = (t = new Date()) => t.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const key = (pass, salt) => crypto.scryptSync(pass, salt, 32);

// AES-256-GCM, written as: "WCB1" + salt + iv + encrypted data + 16-byte tag.
function encryptStream(pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(pass, salt), iv);
  let first = true;
  return new Transform({
    transform(chunk, enc, cb) { if (first) { this.push(Buffer.concat([MAGIC, salt, iv])); first = false; } cb(null, c.update(chunk)); },
    flush(cb) { if (first) this.push(Buffer.concat([MAGIC, salt, iv])); this.push(c.final()); this.push(c.getAuthTag()); cb(); },
  });
}
function decryptBuffer(buf, pass) {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('This is not an encrypted Watchcoin backup');
  const salt = buf.subarray(4, 20), iv = buf.subarray(20, 32), tag = buf.subarray(buf.length - 16), d = crypto.createDecipheriv('aes-256-gcm', key(pass, salt), iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(buf.subarray(32, buf.length - 16)), d.final()]); } catch (e) { throw new Error('Wrong passphrase, or the backup is damaged'); }
}
// Turns a backup file's bytes back into a database file's bytes.
function openBackup(buf, pass) {
  const raw = buf.subarray(0, 4).equals(MAGIC) ? decryptBuffer(buf, pass) : buf;
  return zlib.gunzipSync(raw);
}

async function s3Client() {
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({ region: cfg.s3.region, endpoint: cfg.s3.endpoint || undefined, forcePathStyle: !!cfg.s3.endpoint, credentials: { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey } });
}
async function upload(file) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const Key = `${cfg.s3.prefix}${path.basename(file)}`;
  await (await s3Client()).send(new PutObjectCommand({ Bucket: cfg.s3.bucket, Key, Body: fs.readFileSync(file), ContentType: 'application/octet-stream' }));
  return `s3://${cfg.s3.bucket}/${Key}`;
}

let running = null;
function runBackup() {
  if (running) return running;
  running = (async () => {
    const started = Date.now(), d = dir(); let out = '', tmp = '', remote = '';
    try {
      fs.mkdirSync(d, { recursive: true });
      tmp = path.join(d, `.tmp-${started}.db`);
      await db.backup(tmp); // a consistent copy, even while people are using the app
      out = path.join(d, `watchcoin-${stamp()}.db.gz${cfg.backupPassphrase ? '.enc' : ''}`);
      await pipeline(fs.createReadStream(tmp), zlib.createGzip(), ...(cfg.backupPassphrase ? [encryptStream(cfg.backupPassphrase)] : []), fs.createWriteStream(out));
      if (remoteOn()) remote = await upload(out);
      const bytes = fs.statSync(out).size;
      const old = fs.readdirSync(d).filter((f) => /^watchcoin-.*\.db\.gz(\.enc)?$/.test(f)).sort().reverse().slice(cfg.backupKeep);
      for (const f of old) fs.unlinkSync(path.join(d, f));
      db.prepare("INSERT INTO backups(started_at,finished_at,status,bytes,file,remote,encrypted) VALUES (?,?,'ok',?,?,?,?)").run(started, Date.now(), bytes, path.basename(out), remote, +!!cfg.backupPassphrase);
      setSetting('last_backup_ok', Date.now());
      return { ok: true, file: path.basename(out), bytes, remote };
    } catch (e) {
      db.prepare("INSERT INTO backups(started_at,finished_at,status,error) VALUES (?,?,'failed',?)").run(started, Date.now(), String(e.message).slice(0, 300));
      alert('backup-failed', `The database backup failed: ${e.message}`, { everyMs: 6 * 3600000 });
      return { ok: false, error: e.message };
    } finally { if (tmp) fs.rmSync(tmp, { force: true }); }
  })().finally(() => { running = null; });
  return running;
}

const lastOk = () => Number(getSetting('last_backup_ok', '0')) || 0;
function status() {
  const last = lastOk();
  return {
    enabled: cfg.backupEnabled, dir: dir(), keep: cfg.backupKeep, everyHours: cfg.backupEveryHours, encrypted: !!cfg.backupPassphrase,
    remote: { configured: remoteOn(), bucket: cfg.s3.bucket || null, endpoint: cfg.s3.endpoint || null }, alerts: !!cfg.alertWebhook,
    lastOk: last || null, stale: cfg.backupEnabled && (!last || Date.now() - last > 1.5 * cfg.backupEveryHours * 3600000),
    history: db.prepare('SELECT id, started_at startedAt, finished_at finishedAt, status, bytes, file, remote, encrypted, error FROM backups ORDER BY id DESC LIMIT 12').all(),
  };
}

// Runs a backup when one is due, and warns if backups have stopped working.
async function tick() {
  if (!cfg.backupEnabled) return;
  const last = lastOk(), age = Date.now() - last;
  if (!last || age >= cfg.backupEveryHours * 3600000) await runBackup();
  const s = status();
  if (s.stale) alert('backup-stale', 'No successful database backup in over a day and a half. Check the System page.', { everyMs: 12 * 3600000 });
}
function start() { setTimeout(() => tick().catch(() => {}), 60000).unref(); setInterval(() => tick().catch(() => {}), 10 * 60000).unref(); }

module.exports = { runBackup, status, start, tick, openBackup, decryptBuffer, s3Client };
