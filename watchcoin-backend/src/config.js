require('dotenv').config({ quiet: true });
const path = require('path');

const prod = process.env.NODE_ENV === 'production';
if (prod && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

module.exports = {
  prod,
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  // On Railway, a mounted Volume is used automatically so the database survives redeploys.
  dbPath: process.env.DB_PATH || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'watchcoin.db') : './data/watchcoin.db'),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  publicUrl: (process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3000')).replace(/\/$/, ''),
  // The account with this email becomes the admin when it signs up.
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  // Minutes offset from UTC used to decide when "today" starts (Ghana is UTC+0).
  tzOffsetMin: Number(process.env.TZ_OFFSET_MINUTES) || 0,
  tokenPriceUsdt: Number(process.env.TOKEN_PRICE_USDT) || 0.005301,
  maxAccountsPerIp: Number(process.env.MAX_ACCOUNTS_PER_IP) || 3,
  requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
  // Railway puts a proxy in front of the app, so real visitor IPs are read from it.
  // Paystack: card and mobile money payments for premium plans. Leave the secret key empty to switch it off.
  paystackSecret: (process.env.PAYSTACK_SECRET_KEY || '').trim(),
  paystackBase: (process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co').replace(/\/$/, ''),
  paystackCurrency: (process.env.PAYSTACK_CURRENCY || 'GHS').trim().toUpperCase(),
  paystackRate: Number(process.env.PAYSTACK_RATE) || 0, // how much local currency equals 1 USDT; the admin can change it later
  // Where Paystack sends people after they pay. Same as PUBLIC_URL when the app is served by this backend.
  frontendUrl: (process.env.FRONTEND_URL || process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3000')).replace(/\/$/, ''),
  trustProxy: process.env.TRUST_PROXY || (process.env.RAILWAY_ENVIRONMENT ? 'true' : false),
};
