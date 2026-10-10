// Two-step login codes (TOTP, RFC 6238): the 6-digit codes shown by Google Authenticator, Authy, 1Password, etc.
// Written here instead of pulling in a package; it is only a few lines and easy to audit.
const crypto = require('crypto');
const cfg = require('./config');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30000;

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('bad base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const newSecret = () => base32Encode(crypto.randomBytes(20));

function codeAt(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

// Returns the time step the code matched (so it can't be used twice), or null.
// Accepts the previous, current and next 30-second window to allow for clock drift.
function verify(secret, code, lastStep = 0, now = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = Math.floor(now / STEP_MS);
  for (const step of [cur - 1, cur, cur + 1]) {
    if (step <= lastStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(codeAt(secret, step)), Buffer.from(c))) return step;
  }
  return null;
}

const otpauthUrl = (secret, email) =>
  `otpauth://totp/${encodeURIComponent(`Watchcoin:${email}`)}?secret=${secret}&issuer=Watchcoin&algorithm=SHA1&digits=6&period=30`;

// Secrets are encrypted in the database so a leaked database file does not leak the codes.
const key = () => crypto.createHash('sha256').update(`totp:${cfg.dataKey}`).digest();
function seal(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}
function open(sealed) {
  const [v, iv, tag, enc] = String(sealed || '').split('.');
  if (v !== 'v1') throw new Error('unknown secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}

// Backup codes: 10 one-time codes for when the phone is lost. Only their hashes are stored.
const hashBackup = (c) => crypto.createHash('sha256').update(String(c).replace(/[\s-]/g, '').toUpperCase()).digest('hex');
function newBackupCodes(n = 10) {
  const { code } = require('./util');
  const codes = Array.from({ length: n }, () => `${code(5)}-${code(5)}`);
  return { codes, hashes: codes.map(hashBackup) };
}

module.exports = { newSecret, codeAt, verify, otpauthUrl, seal, open, hashBackup, newBackupCodes, base32Encode, base32Decode, STEP_MS };
