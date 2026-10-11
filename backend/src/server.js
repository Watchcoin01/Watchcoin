const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cfg = require('./config');
const { db } = require('./db');
const { auth, staffOnly, errorHandler, notFound } = require('./middleware');

function createApp() {
  const app = express();
  if (cfg.trustProxy) app.set('trust proxy', cfg.trustProxy === 'true' ? 1 : cfg.trustProxy);
  app.disable('x-powered-by');
  // The app page loads its script and styles from this server. Images may be uploaded covers (data URLs).
  // upgrade-insecure-requests is only switched on in production, because some browsers apply it to http://localhost.
  app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': cfg.prod ? [] : null } } }));
  app.use(cors({ origin: cfg.corsOrigin === '*' ? true : cfg.corsOrigin.split(',').map((s) => s.trim()) }));
  // The raw body is kept so payment webhooks can check their signature.
  app.use(express.json({ limit: '300kb', verify: (req, res, buf) => { req.rawBody = buf; } }));

  // Payment provider webhooks come before the rate limit, so a busy day never blocks a payment.
  app.use('/api/webhooks', require('./routes/webhooks'));

  const skip = () => process.env.NODE_ENV === 'test';
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, skip }));
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, skip,
    message: { error: 'Too many attempts. Please try again later.' } });

  // Wheel animal videos. Cross-origin is allowed so the admin dashboard (another address) can preview them.
  // Each upload gets a new file name, so the files can be cached for a long time. Range requests let phones stream them.
  app.use('/media', express.static(require('./media').DIR, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny',
    setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin') }));

  app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));
  app.get('/api/public/stats', (req, res) => res.json(require('./routes/user').publicStats()));

  // Link sent in the verification email.
  app.get('/verify-email', (req, res) => {
    const r = db.prepare('UPDATE users SET email_verified=1, verify_token=NULL WHERE verify_token=?').run(String(req.query.token || ''));
    res.status(r.changes ? 200 : 400).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Watchcoin</title><body style="font-family:system-ui;text-align:center;padding:48px"><h1>${r.changes ? 'Email verified' : 'This link is not valid'}</h1><p><a href="/">Back to Watchcoin</a></p>`);
  });

  app.use('/api/auth', authLimiter, require('./routes/auth'));
  app.use('/api/admin', auth, staffOnly, require('./routes/admin'));
  app.use('/api', auth, require('./routes/user'), require('./routes/security'), require('./routes/play'), require('./routes/premium'));
  app.use('/api', notFound);

  app.use(express.static(path.join(__dirname, '..', 'public'))); // drop the Watchcoin frontend into /public
  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  createApp().listen(cfg.port, () => {
    console.log(`Watchcoin API listening on http://localhost:${cfg.port}`);
    const hasOwner = db.prepare("SELECT 1 FROM users WHERE role='owner'").get();
    if (!hasOwner && cfg.adminSetupCode) console.log('No owner yet. Sign up or sign in, then claim the owner role with ADMIN_SETUP_CODE.');
    if (!hasOwner && !cfg.adminSetupCode) console.log(cfg.prod ? 'No owner yet. Set ADMIN_SETUP_CODE to claim the owner account.' : 'No owner yet. The account that signs up with ADMIN_EMAIL becomes the owner (development only).');
    if (cfg.prod && hasOwner && cfg.adminSetupCode) console.log('Tip: the owner exists, so you can remove ADMIN_SETUP_CODE now.');
    if (!cfg.paystack.secretKey) console.log('Paystack is off (PAYSTACK_SECRET_KEY not set). Premium uses manual payments only.');
    if (cfg.jwtSecret === 'dev-only-secret-change-me') console.log('Warning: using the development JWT secret. Set JWT_SECRET before going live.');
  });
}

module.exports = { createApp };
