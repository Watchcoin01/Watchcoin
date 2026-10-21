const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const push = require('../push');
const { HttpError, parse } = require('../util');

const router = express.Router();

router.get('/push/key', (req, res) => res.json({ publicKey: push.publicKey() }));

router.post('/push/subscribe', (req, res) => {
  const { subscription: s } = parse(z.object({ subscription: z.object({
    endpoint: z.string().url().max(600).refine((u) => u.startsWith('https://'), 'must be an https address'),
    keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(6).max(100) }),
  }) }), req.body);
  db.transaction(() => {
    // the same phone may move to another account, so the address is what is unique
    db.prepare('INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,created_at) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth')
      .run(req.user.id, s.endpoint, s.keys.p256dh, s.keys.auth, Date.now());
    const old = db.prepare('SELECT id FROM push_subscriptions WHERE user_id=? ORDER BY id DESC LIMIT -1 OFFSET 5').all(req.user.id); // keep each person to 5 phones
    for (const o of old) db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(o.id);
  })();
  res.status(201).json({ ok: true });
});

router.post('/push/unsubscribe', (req, res) => {
  const { endpoint } = parse(z.object({ endpoint: z.string().max(600) }), req.body);
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').run(endpoint, req.user.id);
  res.json({ ok: true });
});

router.post('/push/test', async (req, res) => {
  const n = await push.sendToUser(req.user.id, { title: 'Watchcoin', body: 'Notifications are working. You will hear from us when your tasks are ready.', url: '/', tag: 'test' });
  if (!n) throw new HttpError(404, 'No phone is signed up for notifications on this account yet');
  res.json({ ok: true, sent: n });
});

router.get('/me/prefs', (req, res) => res.json({ prefs: push.prefsOf(req.user) }));
router.put('/me/prefs', (req, res) => {
  const b = parse(z.object({ push_tasks: z.boolean().optional(), push_streak: z.boolean().optional(), push_plan: z.boolean().optional(), email_plan: z.boolean().optional() }), req.body);
  const next = { ...push.prefsOf(req.user), ...b };
  db.prepare('UPDATE users SET prefs=? WHERE id=?').run(JSON.stringify(next), req.user.id);
  res.json({ prefs: next });
});

module.exports = router;
