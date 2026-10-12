// Paystack: card and mobile money payments for premium plans.
// Flow: we start the payment on our server -> the person pays on Paystack -> Paystack tells us (webhook) and sends the
// person back. We never trust either message on its own: we always ask Paystack for the real result before giving a plan.
const crypto = require('crypto');
const cfg = require('./config');
const { db, getSetting } = require('./db');
const R = require('./rules');
const S = require('./services');
const { HttpError } = require('./util');

const configured = () => !!cfg.paystackSecret;
const rate = () => Number(getSetting('paystack_rate', cfg.paystackRate || '')) || 0;
const enabled = () => configured() && rate() > 0;
const mode = () => (cfg.paystackSecret.startsWith('sk_live_') ? 'live' : cfg.paystackSecret.startsWith('sk_test_') ? 'test' : 'unknown');
// Plan prices are set in USDT. Paystack charges in local currency, in its smallest unit (pesewas for GHS).
const minorFor = (usdt) => Math.ceil(usdt * rate() * 100);

const publicInfo = () => ({ enabled: enabled(), currency: cfg.paystackCurrency, prices: R.PLANS.map((p) => (p.priceUsdt ? minorFor(p.priceUsdt) / 100 : 0)) });
const adminInfo = () => ({ configured: configured(), mode: configured() ? mode() : null, currency: cfg.paystackCurrency, rate: rate() || null, enabled: enabled(), webhookUrl: `${cfg.publicUrl}/api/webhooks/paystack` });

async function call(method, path, body) {
  let r;
  try {
    r = await fetch(cfg.paystackBase + path, { method, headers: { authorization: `Bearer ${cfg.paystackSecret}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) { throw new HttpError(502, 'Could not reach Paystack. Please try again.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status === false) throw new HttpError(502, `Paystack: ${j.message || r.status}`);
  return j.data;
}

// Paystack signs the exact bytes it sends with HMAC-SHA512, using your secret key.
function verifySignature(raw, signature) {
  const expected = Buffer.from(crypto.createHmac('sha512', cfg.paystackSecret).update(raw).digest('hex'));
  const got = Buffer.from(String(signature || ''));
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

// Checks a payment with Paystack and, if it really succeeded for the right amount, starts the plan.
// Safe to run many times for the same payment (webhook, return page, retries): the plan starts only once.
async function settle(reference) {
  const pay = db.prepare('SELECT * FROM payments WHERE reference = ?').get(reference);
  if (!pay) throw new HttpError(404, 'Payment not found');
  if (pay.status === 'success') return { status: 'success' };
  const d = await call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  if (d.status !== 'success') {
    if (d.status === 'failed' || d.status === 'abandoned') db.prepare("UPDATE payments SET status=? WHERE id=? AND status='pending'").run(d.status, pay.id);
    return { status: d.status === 'failed' || d.status === 'abandoned' ? d.status : 'pending' };
  }
  if (d.amount !== pay.amount_minor || String(d.currency).toUpperCase() !== pay.currency || d.reference !== reference) {
    db.prepare("UPDATE payments SET status='review' WHERE id=? AND status='pending'").run(pay.id);
    console.error(`Paystack payment ${reference} does not match what we asked for (got ${d.amount} ${d.currency}, expected ${pay.amount_minor} ${pay.currency})`);
    return { status: 'review' };
  }
  db.transaction(() => {
    const r = db.prepare("UPDATE payments SET status='success', channel=?, paid_at=? WHERE id=? AND status!='success'").run(d.channel || '', Date.now(), pay.id);
    if (r.changes) S.activatePlan(pay.user_id, pay.plan);
  })();
  return { status: 'success' };
}

module.exports = { configured, enabled, rate, mode, minorFor, publicInfo, adminInfo, call, verifySignature, settle };
