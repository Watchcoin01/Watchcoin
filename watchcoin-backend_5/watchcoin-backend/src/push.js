// Phone notifications (web push). People allow them once in the app, then we can tell them when tasks are ready, a streak is
// about to end, or a plan is running out, even when the app is closed.
const webpush = require('web-push');
const cfg = require('./config');
const { db, getSetting, setSetting } = require('./db');

// The keys that prove the messages come from us. Made once and stored; set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to use your own.
function vapid() {
  let pub = process.env.VAPID_PUBLIC_KEY || getSetting('vapid_public'), priv = process.env.VAPID_PRIVATE_KEY || getSetting('vapid_private');
  if (!pub || !priv) { const k = webpush.generateVAPIDKeys(); pub = k.publicKey; priv = k.privateKey; setSetting('vapid_public', pub); setSetting('vapid_private', priv); }
  return { pub, priv };
}
const subject = () => cfg.vapidSubject || `mailto:admin@${new URL(cfg.publicUrl).hostname}`;
let ready = false;
function init() { if (ready) return; const k = vapid(); webpush.setVapidDetails(subject(), k.pub, k.priv); ready = true; }
const publicKey = () => vapid().pub;

// Tests replace this so no real phone is needed.
const transport = { send: (sub, payload, opts) => webpush.sendNotification(sub, payload, opts) };

const DEFAULT_PREFS = { push_tasks: true, push_streak: true, push_plan: true, email_plan: true };
const prefsOf = (u) => { try { return { ...DEFAULT_PREFS, ...JSON.parse(u.prefs || '{}') }; } catch { return { ...DEFAULT_PREFS }; } };

// Sends one notification to all of a person's phones. Phones that have gone away are forgotten.
async function sendToUser(userId, { title, body, url = '/', tag }) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id=?').all(userId);
  if (!subs.length) return 0;
  init();
  let sent = 0;
  for (const s of subs) {
    try {
      await transport.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body, url, tag }), { TTL: 86400 });
      db.prepare('UPDATE push_subscriptions SET last_ok=? WHERE id=?').run(Date.now(), s.id); sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(s.id);
      else console.error(`[push] could not send to subscription ${s.id}: ${e.statusCode || ''} ${e.message}`);
    }
  }
  return sent;
}

module.exports = { init, publicKey, sendToUser, transport, prefsOf, DEFAULT_PREFS };
