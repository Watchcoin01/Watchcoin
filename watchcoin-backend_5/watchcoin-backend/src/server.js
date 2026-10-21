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
  // Task cover pictures, served as normal images so the app does not have to download them inside every task list.
  // Public on purpose (an <img> tag cannot send a login), cached by the browser, and open to other sites (the admin dashboard).
  app.get('/api/covers/:id', (req, res) => {
    const t = db.prepare('SELECT cover FROM tasks WHERE id=? AND active=1').get(Number(req.params.id));
    const m = t && /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(t.cover);
    if (!m) return res.sendStatus(404);
    res.set({ 'Content-Type': `image/${m[1]}`, 'Cache-Control': 'public, max-age=604800', 'Cross-Origin-Resource-Policy': 'cross-origin' });
    res.send(Buffer.from(m[2], 'base64'));
  });
  // Paystack webhook: needs the raw bytes to check the signature, so it is set up before the JSON parser.
  app.post('/api/webhooks/paystack', express.raw({ type: '*/*', limit: '200kb' }), async (req, res) => {
    const ps = require('./paystack');
    if (!ps.configured() || !Buffer.isBuffer(req.body) || !ps.verifySignature(req.body, req.get('x-paystack-signature'))) return res.sendStatus(401);
    let ev;
    try { ev = JSON.parse(req.body.toString('utf8')); } catch (e) { return res.sendStatus(400); }
    const ref = ev && ev.data && ev.data.reference;
    if (ev.event === 'charge.success' && ref && db.prepare('SELECT 1 FROM payments WHERE reference=?').get(ref)) {
      try { await ps.settle(ref); } catch (e) { console.error('Paystack webhook failed:', e.message); return res.sendStatus(500); } // 500 makes Paystack retry later
    }
    res.sendStatus(200);
  });
  app.use(express.json({ limit: '300kb' }));

  const skip = () => process.env.NODE_ENV === 'test';
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, skip }));
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, skip,
    message: { error: 'Too many attempts. Please try again later.' } });

  // Point an uptime monitor (UptimeRobot, Better Stack) at this. It also checks that the database answers.
  app.get('/api/health', (req, res) => {
    try { db.prepare('SELECT 1').get(); res.json({ ok: true, db: 'ok', time: Date.now() }); } catch (e) { res.status(503).json({ ok: false, db: 'down' }); }
  });
  app.get('/api/public/stats', (req, res) => res.json(require('./routes/user').publicStats()));

  // Link sent in the verification email.
  app.get('/verify-email', (req, res) => {
    const r = db.prepare('UPDATE users SET email_verified=1, verify_token=NULL WHERE verify_token=?').run(String(req.query.token || ''));
    res.status(r.changes ? 200 : 400).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Watchcoin</title><body style="font-family:system-ui;text-align:center;padding:48px"><h1>${r.changes ? 'Email verified' : 'This link is not valid'}</h1><p><a href="/">Back to Watchcoin</a></p>`);
  });

  app.use('/api/auth', authLimiter, require('./routes/auth'));
  app.use('/api/admin', auth, staffOnly, require('./routes/admin'));
  app.use('/api', auth, require('./routes/security'), require('./routes/push'), require('./routes/user'), require('./routes/play'), require('./routes/premium'));
  app.use('/api', notFound);

  app.use(express.static(path.join(__dirname, '..', 'public'))); // drop the Watchcoin frontend into /public
  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  createApp().listen(cfg.port, () => {
    console.log(`Watchcoin API listening on http://localhost:${cfg.port}`);
    // Look for incoming USDT payments in the background, so plans start even if the person closed the app.
    const tron = require('./tron');
    setInterval(() => tron.scan().catch((e) => require('./alerts').alert('usdt-scan', `Checking USDT payments is failing: ${e.message}`, { everyMs: 3600000 })), cfg.cryptoScanSeconds * 1000).unref();
    require('./backup').start();
    require('./reminders').start();
    if (!cfg.adminEmail) console.log('Tip: set ADMIN_EMAIL so that account becomes the admin when it signs up.');
    if (cfg.jwtSecret === 'dev-only-secret-change-me') console.log('Warning: using the development JWT secret. Set JWT_SECRET before going live.');
  });
}

module.exports = { createApp };
