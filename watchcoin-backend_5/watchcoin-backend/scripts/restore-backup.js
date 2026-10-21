#!/usr/bin/env node
// Turns a backup into a working database file.
//   node scripts/restore-backup.js <backup-file> <output.db>
//   node scripts/restore-backup.js --from-s3 <object-key> <output.db>
// Encrypted backups (.enc) need BACKUP_PASSPHRASE. Stop the app before replacing its database file.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const Database = require('better-sqlite3');
const { openBackup, s3Client } = require('../src/backup');
const cfg = require('../src/config');

(async () => {
  const a = process.argv.slice(2);
  const fromS3 = a[0] === '--from-s3', [src, out] = fromS3 ? [a[1], a[2]] : [a[0], a[1]];
  if (!src || !out) { console.error('Usage: node scripts/restore-backup.js [--from-s3] <backup-file-or-key> <output.db>'); process.exit(1); }
  let buf;
  if (fromS3) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const r = await (await s3Client()).send(new GetObjectCommand({ Bucket: cfg.s3.bucket, Key: src }));
    buf = Buffer.from(await r.Body.transformToByteArray());
  } else buf = fs.readFileSync(src);
  if (fs.existsSync(out)) { console.error(`${out} already exists. Move it away first, so nothing is overwritten by accident.`); process.exit(1); }
  fs.writeFileSync(out, openBackup(buf, cfg.backupPassphrase));
  const db = new Database(out, { readonly: true });
  const check = db.pragma('integrity_check', { simple: true });
  const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  db.close();
  console.log(`Restored to ${out}. Integrity check: ${check}. Users in this backup: ${users}.`);
  if (check !== 'ok') process.exit(2);
})().catch((e) => { console.error('Restore failed:', e.message); process.exit(1); });
