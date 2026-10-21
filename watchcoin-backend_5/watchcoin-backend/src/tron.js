// Automatic USDT payments on the TRON network (TRC20), checked through TronGrid.
//
// How it works: each order gets its own exact amount, such as 5.0042 USDT (the plan price plus a few hundredths of a cent).
// We then look at the confirmed USDT transfers into your address. A transfer for exactly that amount, to your address, in the
// real USDT contract, after the order was made, can only belong to that order. No guessing and no way to claim someone else's
// payment.
const crypto = require('crypto');
const cfg = require('./config');
const { db, getSetting } = require('./db');
const R = require('./rules');
const S = require('./services');
const { HttpError } = require('./util');

const ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/; // a TRON (Base58) address
const GRACE_MS = 24 * 3600000; // money that arrives late is still honoured for a day
const address = () => getSetting('tron_address', '');
const enabled = () => ADDRESS.test(address());
// Always at least 4 decimals, so 5.001 is shown as 5.0010 and people type the exact amount.
const fmt = (micro) => { const [i, f = ''] = (micro / 1e6).toFixed(6).replace(/0+$/, '').split('.'); return `${i}.${f.padEnd(4, '0')}`; };

const view = (o, extra = {}) => ({
  id: o.id, plan: o.plan, planName: R.PLANS[o.plan].name, amount: fmt(o.amount_micro), amountMicro: o.amount_micro, address: o.address,
  network: 'TRON (TRC20)', token: 'USDT', status: o.status, expiresAt: o.expires_at, expired: Date.now() > o.expires_at, txid: o.txid, paidAt: o.paid_at, ...extra,
});

function createOrder(user, plan) {
  if (!enabled()) throw new HttpError(503, 'USDT payments are not available yet');
  if (plan < 1 || plan >= R.PLANS.length) throw new HttpError(400, 'Choose a premium plan');
  if (plan < R.activePlan(user)) throw new HttpError(400, 'You already have a higher plan');
  const now = Date.now();
  const same = db.prepare("SELECT * FROM crypto_orders WHERE user_id=? AND plan=? AND status='pending' AND expires_at>? ORDER BY id DESC").get(user.id, plan, now);
  if (same) return same; // keep the same amount if they come back to it
  if (db.prepare('SELECT COUNT(*) c FROM crypto_orders WHERE user_id=? AND created_at>?').get(user.id, now - 3600000).c >= 5) throw new HttpError(429, 'Too many payment attempts. Please try again later.');
  const base = R.PLANS[plan].priceUsdt * 1e6, taken = (m) => db.prepare("SELECT 1 FROM crypto_orders WHERE amount_micro=? AND status='pending' AND expires_at>?").get(m, now - GRACE_MS);
  let micro = 0;
  for (let i = 0; i < 80 && !micro; i++) { // try 4 decimals first (5.0042), then 5 decimals if many orders are open at once
    const c = base + (i < 40 ? crypto.randomInt(1, 100) * 100 : crypto.randomInt(1, 1000) * 10);
    if (!taken(c)) micro = c;
  }
  if (!micro) throw new HttpError(503, 'Too many payments are open right now. Please try again in a few minutes.');
  const id = db.prepare('INSERT INTO crypto_orders(user_id,plan,amount_micro,address,created_at,expires_at) VALUES (?,?,?,?,?,?)')
    .run(user.id, plan, micro, address(), now, now + cfg.cryptoOrderMinutes * 60000).lastInsertRowid;
  return db.prepare('SELECT * FROM crypto_orders WHERE id=?').get(id);
}

async function fetchTransfers(addr) {
  const url = `${cfg.tronBase}/v1/accounts/${addr}/transactions/trc20?only_confirmed=true&limit=200&contract_address=${cfg.usdtContract}`;
  const r = await fetch(url, { headers: cfg.tronApiKey ? { 'TRON-PRO-API-KEY': cfg.tronApiKey } : {} });
  if (!r.ok) throw new Error(`TronGrid answered ${r.status}`);
  const j = await r.json();
  return Array.isArray(j.data) ? j.data : [];
}

// Does this transfer pay this order? Every condition must hold.
const pays = (t, o) => t && t.to === o.address && t.token_info && t.token_info.address === cfg.usdtContract && t.type === 'Transfer'
  && /^\d+$/.test(String(t.value)) && BigInt(t.value) === BigInt(o.amount_micro) && Number(t.block_timestamp) >= o.created_at - 60000
  && /^[0-9a-f]{64}$/i.test(String(t.transaction_id));

let running = null;
// Looks for payments and starts plans. Safe to call often and from several places at once.
function scan() {
  if (running) return running;
  running = (async () => {
    if (!enabled()) return { matched: 0 };
    const now = Date.now();
    db.prepare("UPDATE crypto_orders SET status='expired' WHERE status='pending' AND expires_at<?").run(now - GRACE_MS);
    const open = db.prepare("SELECT * FROM crypto_orders WHERE status='pending' AND address=?").all(address());
    if (!open.length) return { matched: 0 };
    const transfers = await fetchTransfers(address());
    let matched = 0;
    for (const o of open) {
      const t = transfers.find((x) => pays(x, o));
      if (!t) continue;
      try {
        db.transaction(() => {
          const r = db.prepare("UPDATE crypto_orders SET status='paid', txid=?, paid_at=? WHERE id=? AND status='pending'").run(t.transaction_id.toLowerCase(), Date.now(), o.id);
          if (r.changes) { S.activatePlan(o.user_id, o.plan); matched++; }
        })();
      } catch (e) { if (!String(e.code).startsWith('SQLITE_CONSTRAINT')) throw e; } // that transaction already paid another order
    }
    return { matched };
  })().finally(() => { running = null; });
  return running;
}

// The app asks about its order every few seconds. We look at the chain at most once every 8 seconds per order.
async function check(userId, id) {
  const o = db.prepare('SELECT * FROM crypto_orders WHERE id=? AND user_id=?').get(id, userId);
  if (!o) throw new HttpError(404, 'Order not found');
  if (o.status === 'pending' && Date.now() - o.last_check > 8000) {
    db.prepare('UPDATE crypto_orders SET last_check=? WHERE id=?').run(Date.now(), o.id);
    try { await scan(); } catch (e) { console.error('USDT check failed:', e.message); }
  }
  const fresh = db.prepare('SELECT * FROM crypto_orders WHERE id=?').get(id);
  const u = S.getUser(userId);
  return view(fresh, fresh.status === 'paid' ? { planExpiresAt: R.activePlan(u) ? u.plan_exp : null } : {});
}

const publicInfo = () => ({ auto: enabled(), network: 'TRON (TRC20)', token: 'USDT', minutes: cfg.cryptoOrderMinutes });
const adminInfo = () => ({ auto: enabled(), address: address() || null, contract: cfg.usdtContract, network: 'TRON (TRC20)' });

module.exports = { ADDRESS, enabled, address, createOrder, check, scan, view, publicInfo, adminInfo, fmt };
