const jwt = require('jsonwebtoken');
const cfg = require('./config');
const { db } = require('./db');
const { HttpError } = require('./util');

const signToken = (userId) => jwt.sign({ sub: userId }, cfg.jwtSecret, { expiresIn: '30d' });

// Loads the user on every request so bans and role changes apply immediately.
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) throw new HttpError(401, 'Please log in');
  let payload;
  try { payload = jwt.verify(token, cfg.jwtSecret); }
  catch { throw new HttpError(401, 'Your session expired. Please log in again.'); }
  if (payload.purpose) throw new HttpError(401, 'Please log in'); // a half-finished two-step sign-in is not a session
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (!user) throw new HttpError(401, 'Account not found');
  if (user.banned) throw new HttpError(403, 'This account is suspended');
  req.user = user;
  next();
}

// Staff are admins and support people. When two-step login is required, they must have set it up first.
function staffOnly(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'support') throw new HttpError(403, 'Staff only');
  if (cfg.requireStaff2fa && !req.user.totp_enabled) throw new HttpError(403, 'Set up two-step login before using the admin tools', { setup2fa: true });
  next();
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') throw new HttpError(403, 'Admins only');
  next();
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  require('./alerts').alert('server-error', `Server error on ${req.method} ${req.path}: ${String(err.message).slice(0, 160)}`);
  res.status(500).json({ error: 'Something went wrong' });
}

const notFound = (req, res) => res.status(404).json({ error: 'Not found' });

module.exports = { signToken, auth, adminOnly, staffOnly, errorHandler, notFound };
