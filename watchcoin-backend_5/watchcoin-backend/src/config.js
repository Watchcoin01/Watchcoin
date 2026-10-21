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
  // Automatic USDT (TRC20 on the TRON network) payments, checked through TronGrid.
  tronBase: (process.env.TRONGRID_BASE_URL || 'https://api.trongrid.io').replace(/\/$/, ''),
  tronApiKey: (process.env.TRONGRID_API_KEY || '').trim(), // optional, gives higher rate limits
  usdtContract: (process.env.USDT_TRC20_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t').trim(),
  cryptoOrderMinutes: Number(process.env.CRYPTO_ORDER_MINUTES) || 60,
  cryptoScanSeconds: Number(process.env.CRYPTO_SCAN_SECONDS) || 30,
  // Backups of the database, and alerts when something goes wrong.
  alertWebhook: (process.env.ALERT_WEBHOOK_URL || '').trim(), // Slack, Discord, or any URL that accepts a JSON POST
  backupEnabled: process.env.BACKUP_ENABLED !== 'false',
  backupDir: process.env.BACKUP_DIR || '',
  backupKeep: Number(process.env.BACKUP_KEEP) || 7,
  backupEveryHours: Number(process.env.BACKUP_INTERVAL_HOURS) || 24,
  backupPassphrase: process.env.BACKUP_PASSPHRASE || '',
  s3: {
    endpoint: (process.env.BACKUP_S3_ENDPOINT || '').trim(), region: process.env.BACKUP_S3_REGION || 'auto', bucket: (process.env.BACKUP_S3_BUCKET || '').trim(),
    accessKeyId: (process.env.BACKUP_S3_ACCESS_KEY_ID || '').trim(), secretAccessKey: (process.env.BACKUP_S3_SECRET_ACCESS_KEY || '').trim(), prefix: process.env.BACKUP_S3_PREFIX || 'watchcoin/',
  },
  // Staff (admin and support) must use two-step login before they can use the admin tools. On by default in production.
  requireStaff2fa: process.env.REQUIRE_STAFF_2FA ? process.env.REQUIRE_STAFF_2FA === 'true' : prod,
  // Email (optional): sends through Resend. Without a key, emails are only printed to the log.
  resendKey: (process.env.RESEND_API_KEY || '').trim(),
  resendBase: (process.env.RESEND_BASE_URL || 'https://api.resend.com').replace(/\/$/, ''),
  mailFrom: process.env.MAIL_FROM || 'Watchcoin <onboarding@resend.dev>',
  // Phone notifications (web push). The keys are made automatically the first time and kept in the database.
  vapidSubject: process.env.VAPID_SUBJECT || '',
  pushTasksHour: process.env.PUSH_TASKS_HOUR === undefined ? 8 : Number(process.env.PUSH_TASKS_HOUR),
  pushStreakHour: process.env.PUSH_STREAK_HOUR === undefined ? 18 : Number(process.env.PUSH_STREAK_HOUR),
  trustProxy: process.env.TRUST_PROXY || (process.env.RAILWAY_ENVIRONMENT ? 'true' : false),
};
