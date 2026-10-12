const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { db, getSetting, DEFAULT_PAYMENT_INFO } = require('../db');
const R = require('../rules');
const { HttpError, parse } = require('../util');
const S = require('../services');
const ps = require('../paystack');
const cfg = require('../config');

const router = express.Router();

// Most a plan can earn in a day: the rewards of the tasks it would show, before level boosts.
const maxPerDay = (planId) => {
  const rows = db.prepare('SELECT tokens FROM tasks WHERE active=1 AND (premium=0 OR ?>0) ORDER BY position,id LIMIT ?').all(planId, R.PLANS[planId].tasksPerDay);
  return rows.reduce((a, t) => a + t.tokens, 0);
};

router.get('/premium', (req, res) => {
  const u = req.user, price = S.tokenPrice(), current = R.activePlan(u);
  res.json({
    current: { id: current, name: R.PLANS[current].name, expiresAt: current ? u.plan_exp : null },
    plans: R.PLANS.map((p) => ({ ...p, days: p.id ? R.PLAN_DAYS : null, maxWtcPerDay: maxPerDay(p.id), maxUsdtPerDay: R.toUsdt(maxPerDay(p.id), price), premiumTasks: p.id > 0 })),
    pending: !!db.prepare("SELECT 1 FROM upgrades WHERE user_id=? AND status='pending'").get(u.id),
    paymentInfo: getSetting('payment_info'),
    // Crypto (USDT) is paid by hand: the person sends it, then an admin confirms. It is offered once the admin has added payment details.
    manual: { enabled: getSetting('payment_info') !== DEFAULT_PAYMENT_INFO, info: getSetting('payment_info') },
    paystack: ps.publicInfo(),
    requests: db.prepare('SELECT id, plan, reference, status, created_at createdAt FROM upgrades WHERE user_id=? ORDER BY id DESC LIMIT 10').all(u.id),
    payments: db.prepare("SELECT reference, plan, amount_minor amountMinor, currency, status, channel, created_at createdAt, paid_at paidAt FROM payments WHERE user_id=? AND status IN ('success','review') ORDER BY id DESC LIMIT 5").all(u.id),
  });
});

// Payments are confirmed by an admin, who then approves the request. Swap this for a payment provider webhook later.
router.post('/premium/upgrade', (req, res) => {
  const b = parse(z.object({ plan: z.number().int().min(1).max(R.PLANS.length - 1), reference: z.string().trim().min(4).max(120) }), req.body);
  const u = req.user;
  if (db.prepare("SELECT 1 FROM upgrades WHERE user_id=? AND status='pending'").get(u.id)) throw new HttpError(409, 'You already have an upgrade waiting for review');
  if (b.plan < R.activePlan(u)) throw new HttpError(400, 'You already have a higher plan');
  db.prepare('INSERT INTO upgrades(user_id,plan,reference,created_at) VALUES (?,?,?,?)').run(u.id, b.plan, b.reference, Date.now());
  S.notify(u.id, `Your ${R.PLANS[b.plan].name} upgrade is waiting for review.`);
  res.status(201).json({ ok: true });
});

// ---- Paystack: pay by card or mobile money ----
router.post('/premium/paystack/initialize', async (req, res) => {
  if (!ps.enabled()) throw new HttpError(503, 'Card and mobile money payments are not available yet');
  const b = parse(z.object({ plan: z.number().int().min(1).max(R.PLANS.length - 1) }), req.body);
  const u = req.user;
  if (b.plan < R.activePlan(u)) throw new HttpError(400, 'You already have a higher plan');
  const recent = db.prepare('SELECT COUNT(*) c FROM payments WHERE user_id=? AND created_at>?').get(u.id, Date.now() - 3600000).c;
  if (recent >= 10) throw new HttpError(429, 'Too many payment attempts. Please try again later.');
  const reference = `wtc-${u.id}-${crypto.randomBytes(8).toString('hex')}`;
  const amount = ps.minorFor(R.PLANS[b.plan].priceUsdt);
  db.prepare('INSERT INTO payments(user_id,plan,reference,amount_minor,currency,created_at) VALUES (?,?,?,?,?,?)').run(u.id, b.plan, reference, amount, cfg.paystackCurrency, Date.now());
  try {
    const d = await ps.call('POST', '/transaction/initialize', {
      email: u.email, amount, currency: cfg.paystackCurrency, reference, callback_url: `${cfg.frontendUrl}/`, metadata: { user_id: u.id, plan: b.plan },
    });
    res.json({ authorizationUrl: d.authorization_url, reference });
  } catch (e) {
    db.prepare("UPDATE payments SET status='failed' WHERE reference=?").run(reference);
    throw e;
  }
});

// The app calls this when Paystack sends the person back, so they see their plan right away.
router.post('/premium/paystack/verify', async (req, res) => {
  const { reference } = parse(z.object({ reference: z.string().trim().min(5).max(100) }), req.body);
  const p = db.prepare('SELECT * FROM payments WHERE reference=? AND user_id=?').get(reference, req.user.id);
  if (!p) throw new HttpError(404, 'Payment not found');
  const r = await ps.settle(reference);
  const fresh = S.getUser(req.user.id);
  res.json({ ...r, plan: R.PLANS[p.plan].name, reference, amountMinor: p.amount_minor, currency: p.currency, paidAt: db.prepare('SELECT paid_at v FROM payments WHERE id=?').get(p.id).v, planExpiresAt: R.activePlan(fresh) ? fresh.plan_exp : null });
});

module.exports = router;
