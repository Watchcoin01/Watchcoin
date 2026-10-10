// Calls from payment providers. No login: each provider proves itself with a signature.
const express = require('express');
const paystack = require('../paystack');

const router = express.Router();

router.post('/paystack', (req, res) => {
  if (!paystack.validSignature(req.rawBody, req.get('x-paystack-signature'))) return res.status(401).json({ error: 'Bad signature' });
  const ev = req.body || {};
  if (ev.event === 'charge.success' && ev.data) {
    const r = paystack.applyTransaction(ev.data);
    if (r.status === 'unknown') console.warn('Paystack webhook for an unknown reference', ev.data.reference);
  }
  res.json({ ok: true }); // Paystack retries until it gets a 200
});

module.exports = router;
