// Email sending. By default this only logs the message, so no mail provider is needed in development.
// To send real email, replace the body of send() with nodemailer, SES, Resend, Postmark, etc.
const cfg = require('./config');

async function send(to, subject, text) {
  if (!cfg.prod) console.log(`[mail] to=${to} subject="${subject}"\n${text}\n`);
  // TODO: plug in a real provider here.
}

const sendVerification = (email, token) =>
  send(email, 'Verify your Watchcoin email', `Open this link to verify your email:\n${cfg.publicUrl}/verify-email?token=${token}`);

module.exports = { send, sendVerification };
