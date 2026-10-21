// Tells you when something needs attention. It always logs, and posts to ALERT_WEBHOOK_URL when one is set
// (Slack and Discord incoming webhooks both work). The same alert is sent at most once per window, so a repeating problem
// does not flood you.
const cfg = require('./config');

const last = new Map();
async function alert(key, text, { everyMs = 10 * 60000 } = {}) {
  const now = Date.now();
  if (now - (last.get(key) || 0) < everyMs) return false;
  last.set(key, now);
  console.error(`[alert] ${text}`);
  if (!cfg.alertWebhook) return false;
  try {
    const msg = `Watchcoin: ${text}`;
    const r = await fetch(cfg.alertWebhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: msg, content: msg }) });
    return r.ok;
  } catch (e) { console.error('[alert] could not send:', e.message); return false; }
}
const resetAlerts = () => last.clear(); // for tests

module.exports = { alert, resetAlerts };
