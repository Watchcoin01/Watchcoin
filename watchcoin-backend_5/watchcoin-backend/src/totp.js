// Two-step login codes (TOTP, RFC 6238), the kind Google Authenticator, Authy, 1Password and Microsoft Authenticator make.
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function b32decode(str) {
  let bits = '';
  for (const ch of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
const newSecret = () => b32encode(crypto.randomBytes(20));

function hotp(secret, counter, digits = 6) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(msg).digest(), o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
const step = (t = Date.now()) => Math.floor(t / 30000);
const code = (secret, t = Date.now()) => hotp(secret, step(t));

// Returns the time step the code belongs to, or 0 if it is wrong. Allows a step either side for clock drift.
function verify(secret, input, t = Date.now()) {
  const c = String(input || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return 0;
  for (const d of [0, -1, 1]) {
    const s = step(t) + d, want = Buffer.from(hotp(secret, s));
    if (crypto.timingSafeEqual(want, Buffer.from(c))) return s;
  }
  return 0;
}
const uri = (email, secret, issuer = 'Watchcoin') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// Recovery codes for when the phone is lost: ten single-use codes like "k7m2q-x9d4f". Only their hashes are stored.
const RC = 'abcdefghjkmnpqrstuvwxyz23456789';
function newRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => { const c = Array.from({ length: 10 }, () => RC[crypto.randomInt(RC.length)]).join(''); return `${c.slice(0, 5)}-${c.slice(5)}`; });
}
const hashCode = (c) => crypto.createHash('sha256').update(String(c).trim().toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
const looksLikeRecovery = (c) => /^[a-z0-9]{5}-?[a-z0-9]{5}$/i.test(String(c).trim());

module.exports = { b32encode, b32decode, newSecret, hotp, code, verify, step, uri, newRecoveryCodes, hashCode, looksLikeRecovery };
