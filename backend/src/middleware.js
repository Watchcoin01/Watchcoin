const jwt = require('jsonwebtoken');
const cfg = require('./config');
const { db } = require('./db');
const { HttpError } = require('./util');
const { isStaff, atLeast } = require('./roles');

// Login tokens carry the user's token_version. Raising that number (password change, reset, ban,
// "log out everywhere", role change) makes every older token stop working at once.
// Staff tokens expire after a few hours; normal users stay logged in for 30 days.
const signToken = (user) => jwt.sign({ sub: user.id, v: user.token_version || 0, typ: 'access' }, cfg.jwtSecret,
  { expiresIn: isStaff(user.role) ? `${cfg.staffSessionHours}h` : '30d' });

// Short-lived token that proves the password was right, while the two-step code is still needed.
const signChallenge = (user) => jwt.sign({ sub: user.id, v: user.token_version || 0, typ: 'mfa' }, cfg.jwtSecret, { expiresIn: '5m' });

// Bump the version and return the fresh user row.
function revokeTokens(userId) {
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

// Loads the user on every request so bans, role changes and revoked logins apply immediately.
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) throw new HttpError(401, 'Please log in');
  let payload;
  try { payload = jwt.verify(token, cfg.jwtSecret); }
  catch { throw new HttpError(401, 'Your session expired. Please log in again.'); }
  if (payload.typ && payload.typ !== 'access') throw new HttpError(401, 'Please log in');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (!user) throw new HttpError(401, 'Account not found');
  if ((payload.v || 0) !== user.token_version) throw new HttpError(401, 'You were signed out. Please log in again.');
  if (user.banned) throw new HttpError(403, 'This account is suspended');
  req.user = user;
  next();
}

// Gate for the whole admin area: any staff role, with two-step login on when required.
function staffOnly(req, res, next) {
  if (!isStaff(req.user.role)) throw new HttpError(403, 'Admins only');
  if (cfg.require2fa && !req.user.totp_enabled) {
    throw new HttpError(403, 'Turn on two-step login to use the admin area', { code: '2fa_required' });
  }
  next();
}

// Per-route check inside the admin area, e.g. need('owner').
const need = (min) => (req, res, next) => {
  if (!atLeast(req.user.role, min)) throw new HttpError(403, `This needs the ${min} role`);
  next();
};

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
}

const notFound = (req, res) => res.status(404).json({ error: 'Not found' });

module.exports = { signToken, signChallenge, revokeTokens, auth, staffOnly, need, errorHandler, notFound };
