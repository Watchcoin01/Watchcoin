// Email. With RESEND_API_KEY set, messages go out through Resend (resend.com). Without it, they are only printed to the log, so
// nothing is needed in development. Failures never break the app: they are logged, and the caller carries on.
const cfg = require('./config');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wrap = (text) => `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:20px;color:#123B70;line-height:1.5">${esc(text).replace(/\n/g, '<br>')}</div>`;

async function send(to, subject, text) {
  if (!cfg.resendKey) { if (!cfg.prod) console.log(`[mail] to=${to} subject="${subject}"\n${text}\n`); return false; }
  try {
    const r = await fetch(`${cfg.resendBase}/emails`, {
      method: 'POST', headers: { authorization: `Bearer ${cfg.resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: cfg.mailFrom, to: [to], subject, text, html: wrap(text) }),
    });
    if (!r.ok) { console.error(`[mail] ${r.status} sending to ${to}: ${(await r.text()).slice(0, 200)}`); return false; }
    return true;
  } catch (e) { console.error('[mail] could not send:', e.message); return false; }
}

const sendVerification = (email, token) =>
  send(email, 'Verify your Watchcoin email', `Open this link to verify your email:\n${cfg.publicUrl}/verify-email?token=${token}`);

module.exports = { send, sendVerification };
