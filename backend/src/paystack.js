// Paystack: Mobile Money (MTN, Telecel, AirtelTigo) and cards in Ghana, Nigeria, Kenya and South Africa.
// Flow: the app asks for a checkout -> the user pays on Paystack's page -> Paystack calls our webhook
// (and the app also asks us to check when the user comes back) -> the plan is switched on.
const crypto = require('crypto');
const cfg = require('./config');
const { db, getSetting } = require('./db');
const R = require('./rules');
const S = require('./services');
const { HttpError } = require('./util');

// How much 1 USDT costs in the payment currency. The owner can change it in Settings.
const fxRate = () => Number(getSetting('fx_rate', '')) || cfg.paystack.fxRate || 0;
const enabled = () => !!cfg.paystack.secretKey && fxRate() > 0;

// Plan price in the smallest unit of the currency (pesewas for GHS, kobo for NGN).
const priceMinor = (plan) => Math.round(S.planPrice(plan) * fxRate() * 100);

async function call(method, path, body) {
  let r;
  try {
    r = await fetch(cfg.paystack.baseUrl + path, {
      method,
      headers: { authorization: `Bearer ${cfg.paystack.secretKey}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new HttpError(502, 'Could not reach the payment provider. Please try again.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status !== true) {
    console.error('Paystack error', r.status, j.message);
    throw new HttpError(502, 'The payment provider refused the request. Please try again later.');
  }
  return j.data;
}

async function startCheckout(user, plan) {
  if (!enabled()) throw new HttpError(503, 'Online payment is not set up yet. Use the manual payment option.');
  const reference = `wc_${user.id}_${crypto.randomBytes(8).toString('hex')}`;
  const amount = priceMinor(plan), currency = cfg.paystack.currency;
  db.prepare('INSERT INTO payments(user_id,plan,provider,reference,amount,currency,created_at,price_usdt) VALUES (?,?,?,?,?,?,?,?)')
    .run(user.id, plan, 'paystack', reference, amount, currency, Date.now(), S.planPrice(plan));
  try {
    const data = await call('POST', '/transaction/initialize', {
      email: user.email, amount, currency, reference,
      callback_url: `${cfg.publicUrl}/?paid=${reference}`,
      metadata: { userId: user.id, plan, planName: R.PLANS[plan].name },
    });
    return { reference, authorizationUrl: data.authorization_url, amount, currency };
  } catch (e) {
    db.prepare("UPDATE payments SET status='failed', note='could not start checkout' WHERE reference=?").run(reference);
    throw e;
  }
}

// Applies a transaction Paystack reported (from the webhook or from verify). Safe to call more than once.
// The amount and currency are compared with what we asked for, so a tampered or partial payment never activates a plan.
function applyTransaction(tx) {
  return db.transaction(() => {
    const p = db.prepare('SELECT * FROM payments WHERE reference=?').get(String(tx.reference || ''));
    if (!p) return { status: 'unknown' };
    if (p.status === 'success' || p.status === 'review') return { status: p.status, payment: p };
    if (tx.status !== 'success') {
      if (['failed', 'abandoned', 'reversed'].includes(tx.status)) {
        db.prepare("UPDATE payments SET status='failed', note=? WHERE id=?").run(`provider said ${tx.status}`, p.id);
        return { status: 'failed', payment: p };
      }
      return { status: 'pending', payment: p };
    }
    if (Number(tx.amount) !== p.amount || String(tx.currency).toUpperCase() !== p.currency) {
      db.prepare("UPDATE payments SET status='review', paid_at=?, note=? WHERE id=?")
        .run(Date.now(), `paid ${tx.amount} ${tx.currency}, expected ${p.amount} ${p.currency}`, p.id);
      S.notify(p.user_id, 'We received a payment that did not match the plan price. Support will contact you.');
      return { status: 'review', payment: p };
    }
    const now = Date.now();
    db.prepare("UPDATE payments SET status='success', paid_at=? WHERE id=?").run(now, p.id);
    // Recorded as an approved upgrade too, so revenue reports include online payments.
    db.prepare("INSERT INTO upgrades(user_id,plan,reference,status,created_at,decided_at,source,price_usdt) VALUES (?,?,?,'approved',?,?,'paystack',?)")
      .run(p.user_id, p.plan, `paystack:${p.reference}`, p.created_at, now, p.price_usdt ?? S.planPrice(p.plan));
    S.activatePlan(p.user_id, p.plan);
    return { status: 'success', payment: p };
  })();
}

async function verify(reference) {
  const data = await call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  return applyTransaction(data);
}

// Paystack signs every webhook with HMAC-SHA512 of the raw body, using the secret key.
function validSignature(rawBody, signature) {
  if (!cfg.paystack.secretKey || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha512', cfg.paystack.secretKey).update(rawBody).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { enabled, fxRate, priceMinor, startCheckout, applyTransaction, verify, validSignature };
