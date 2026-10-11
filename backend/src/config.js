require('dotenv').config({ quiet: true });
const path = require('path');

// Treated as production when NODE_ENV=production OR when running on Railway. This way, forgetting to set
// NODE_ENV can never leave the server running with the publicly known development secret.
const prod = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
if (prod && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}
if (prod && process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET is too short. Use at least 32 random characters (openssl rand -hex 32).');
}
if (prod && process.env.DATA_KEY && process.env.DATA_KEY.length < 32) {
  throw new Error('DATA_KEY is too short. Use at least 32 random characters.');
}
const bool = (v, dflt) => (v === undefined || v === '' ? dflt : v === 'true');

module.exports = {
  prod,
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  // Key used to encrypt two-step login secrets in the database. Falls back to JWT_SECRET.
  dataKey: process.env.DATA_KEY || process.env.JWT_SECRET || 'dev-only-secret-change-me',
  // On Railway, a mounted Volume is used automatically so the database survives redeploys.
  dbPath: process.env.DB_PATH || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'watchcoin.db') : './data/watchcoin.db'),
  corsOrigin: process.env.CORS_ORIGIN || '*', // in production, set this to your admin address
  publicUrl: (process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3000')).replace(/\/$/, ''),

  // ---- who runs the app ----
  // Only this email may claim the owner account (optional, but recommended).
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  // One-time code that turns an account into the owner. Works only while no owner exists.
  adminSetupCode: (process.env.ADMIN_SETUP_CODE || '').trim(),
  // Staff (support, admin, owner) must have two-step login on to use the admin area.
  require2fa: bool(process.env.ADMIN_REQUIRE_2FA, prod),
  // Staff logins expire sooner than normal logins.
  staffSessionHours: Number(process.env.STAFF_SESSION_HOURS) || 12,

  // Minutes offset from UTC used to decide when "today" starts (Ghana is UTC+0).
  tzOffsetMin: Number(process.env.TZ_OFFSET_MINUTES) || 0,
  tokenPriceUsdt: Number(process.env.TOKEN_PRICE_USDT) || 0.005301,
  maxAccountsPerIp: Number(process.env.MAX_ACCOUNTS_PER_IP) || 3,
  requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
  // Railway puts a proxy in front of the app, so real visitor IPs are read from it.
  trustProxy: process.env.TRUST_PROXY || (process.env.RAILWAY_ENVIRONMENT ? 'true' : false),

  // ---- Paystack (automatic premium payments) ----
  paystack: {
    secretKey: (process.env.PAYSTACK_SECRET_KEY || '').trim(),
    currency: (process.env.PAYSTACK_CURRENCY || 'GHS').trim().toUpperCase(),
    // How much 1 USDT costs in PAYSTACK_CURRENCY. The owner can change it later in Settings.
    fxRate: Number(process.env.PAYSTACK_FX_RATE) || 0,
    baseUrl: (process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co').replace(/\/$/, ''),
  },
};
