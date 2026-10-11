const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

if (cfg.dbPath !== ':memory:') fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });

const db = new Database(cfg.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  ref_code TEXT NOT NULL UNIQUE,
  referred_by INTEGER REFERENCES users(id),
  referral_paid INTEGER NOT NULL DEFAULT 0,
  balance INTEGER NOT NULL DEFAULT 0,
  lifetime INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  last_claim TEXT,
  spin_day TEXT,
  spin_prize INTEGER,
  spin_index INTEGER,
  all_done_day TEXT,
  plan INTEGER NOT NULL DEFAULT 0,
  plan_exp INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  flags INTEGER NOT NULL DEFAULT 0,
  avatar TEXT,
  lang TEXT NOT NULL DEFAULT 'en',
  onboarded INTEGER NOT NULL DEFAULT 0,
  email_verified INTEGER NOT NULL DEFAULT 0,
  verify_token TEXT,
  signup_ip TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('watch','like','subscribe','poll')),
  title TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  tokens INTEGER NOT NULL,
  secs INTEGER NOT NULL DEFAULT 0,
  question TEXT NOT NULL DEFAULT '',
  options TEXT NOT NULL DEFAULT '[]',
  answer INTEGER NOT NULL DEFAULT 0,
  cover TEXT NOT NULL DEFAULT '',
  premium INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  double_until INTEGER NOT NULL DEFAULT 0,
  budget INTEGER NOT NULL DEFAULT 0,
  spent INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  day TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started','done','failed')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE (user_id, task_id, day)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_day ON sessions(user_id, day);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, id);
CREATE INDEX IF NOT EXISTS idx_ledger_time ON ledger(created_at);

CREATE TABLE IF NOT EXISTS challenge_claims (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start INTEGER NOT NULL,
  challenge_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, week_start, challenge_id)
);

CREATE TABLE IF NOT EXISTS achievements (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notifications(user_id, id);

CREATE TABLE IF NOT EXISTS upgrades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan INTEGER NOT NULL,
  reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id INTEGER,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  audience TEXT NOT NULL,
  recipients INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_ip ON users(signup_ip);

-- Online payments (Paystack). One row per checkout the user starts.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan INTEGER NOT NULL,
  provider TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','review')),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, id);
`);

// ---- migrations for databases created by older versions ----
function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn('users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'totp_secret', 'TEXT');
addColumn('users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'totp_last_step', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'backup_codes', "TEXT NOT NULL DEFAULT '[]'");
addColumn('users', 'mfa_fails', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'mfa_locked_until', 'INTEGER NOT NULL DEFAULT 0');
addColumn('upgrades', 'source', "TEXT NOT NULL DEFAULT 'manual'");
addColumn('users', 'country', 'TEXT'); // ISO code such as GH or TG, chosen at sign-up

// Roles used to be just 'user' and 'admin'. The first admin becomes the owner.
if (!db.prepare("SELECT 1 FROM users WHERE role='owner'").get()) {
  const first = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get();
  if (first) db.prepare("UPDATE users SET role='owner' WHERE id=?").run(first.id);
}

// ---- settings ----
const getSetting = (key, fallback = '') => {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
};
const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));

// ---- starter tasks (placeholders: replace with your real videos in the admin API) ----
const S = 'Did the video load and play?';
const YN = ['Yes', 'No'];
const STARTERS = [
  // [type, title, tokens, secs, url, question, options, answerIndex, premium]
  ['watch', 'How tokens are earned', 10, 15, 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', S, YN, 0, 0],
  ['watch', 'Community update', 20, 25, 'https://www.youtube.com/watch?v=YE7VzlLtp-4', S, YN, 0, 0],
  ['like', 'Weekly highlights', 8, 10, 'https://www.youtube.com/watch?v=LXb3EKWsInQ', '', [], 0, 0],
  ['subscribe', 'Our YouTube channel', 15, 15, 'https://www.youtube.com/@YouTube', '', [], 0, 0],
  ['poll', 'Which video should we make next?', 5, 0, '', 'Pick one', ['Tutorials', 'Interviews', 'News'], 0, 0],
  ['watch', 'Deep dive (bonus)', 35, 40, 'https://www.youtube.com/watch?v=C0DPdy98e4c', S, YN, 0, 0],
  ['watch', 'Premium: Market insights', 30, 30, 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', S, YN, 0, 1],
  ['subscribe', 'Premium: Partner channel', 25, 15, 'https://www.youtube.com/@YouTube', '', [], 0, 1],
  ['watch', 'Premium: Founder interview', 45, 40, 'https://www.youtube.com/watch?v=YE7VzlLtp-4', S, YN, 0, 1],
  ['like', 'Premium: Launch video', 20, 10, 'https://www.youtube.com/watch?v=LXb3EKWsInQ', '', [], 0, 1],
  ['poll', 'Premium: Product survey', 15, 0, '', 'Which feature do you want most?', ['Transfers', 'Convert', 'Staking'], 0, 1],
  ['watch', 'Premium: Deep dive series', 60, 50, 'https://www.youtube.com/watch?v=C0DPdy98e4c', S, YN, 0, 1],
  ['watch', 'Premium: Weekly briefing', 35, 30, 'https://www.youtube.com/watch?v=jNQXAC9IVRw', S, YN, 0, 1],
  ['watch', 'Premium: Behind the scenes', 50, 45, 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', S, YN, 0, 1],
];

if (db.prepare('SELECT COUNT(*) c FROM tasks').get().c === 0) {
  const ins = db.prepare(`INSERT INTO tasks(type,title,tokens,secs,url,question,options,answer,premium,position,created_at)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    STARTERS.forEach((t, i) => ins.run(t[0], t[1], t[2], t[3], t[4], t[5], JSON.stringify(t[6]), t[7], t[8], i, Date.now()));
  })();
}
if (!getSetting('token_price')) setSetting('token_price', cfg.tokenPriceUsdt);
if (!getSetting('payment_info')) setSetting('payment_info', 'Payment details have not been added yet. Please check back soon.');

module.exports = { db, getSetting, setSetting };
