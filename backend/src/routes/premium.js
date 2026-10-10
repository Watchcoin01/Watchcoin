const express = require('express');
const { z } = require('zod');
const { db, getSetting } = require('../db');
const R = require('../rules');
const { HttpError, parse } = require('../util');
const S = require('../services');
const cfg = require('../config');
const paystack = require('../paystack');

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
    requests: db.prepare('SELECT id, plan, reference, status, created_at createdAt FROM upgrades WHERE user_id=? ORDER BY id DESC LIMIT 10').all(u.id),
    onlinePayment: paystack.enabled()
      ? { enabled: true, provider: 'paystack', currency: cfg.paystack.currency,
        prices: R.PLANS.filter((p) => p.id > 0).map((p) => ({ plan: p.id, amount: paystack.priceMinor(p.id) / 100 })) }
      : { enabled: false },
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

// Online payment: returns a Paystack page to send the user to. The plan switches on by itself once paid.
const planBody = z.object({ plan: z.number().int().min(1).max(R.PLANS.length - 1) });
router.post('/premium/checkout', async (req, res) => {
  const { plan } = parse(planBody, req.body);
  if (plan < R.activePlan(req.user)) throw new HttpError(400, 'You already have a higher plan');
  const open = db.prepare("SELECT COUNT(*) c FROM payments WHERE user_id=? AND status='pending' AND created_at>?").get(req.user.id, Date.now() - 3600000).c;
  if (open >= 5) throw new HttpError(429, 'Too many unfinished payments. Please wait a little and try again.');
  res.status(201).json(await paystack.startCheckout(req.user, plan));
});

// The app calls this when the user comes back from the payment page, in case the webhook is slow.
router.get('/premium/checkout/:reference', async (req, res) => {
  const ref = parse(z.string().regex(/^wc_\d+_[a-f0-9]{16}$/, 'not a payment reference'), req.params.reference);
  let p = db.prepare('SELECT * FROM payments WHERE reference=? AND user_id=?').get(ref, req.user.id);
  if (!p) throw new HttpError(404, 'Payment not found');
  if (p.status === 'pending') {
    await paystack.verify(ref);
    p = db.prepare('SELECT * FROM payments WHERE id=?').get(p.id);
  }
  const u = S.getUser(req.user.id);
  res.json({ reference: ref, status: p.status, plan: R.PLANS[p.plan].name, user: S.publicUser(u) });
});

module.exports = router;
