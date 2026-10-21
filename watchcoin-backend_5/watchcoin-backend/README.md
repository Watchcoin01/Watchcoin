# Watchcoin backend

Node.js + Express + SQLite API for the Watchcoin task-and-earn app. The server decides everything that
touches tokens: whether a task was really watched, whether an answer is right, how much is paid, and who
may see premium tasks. The browser can no longer edit its own balance.

## Run it

```bash
npm install
cp .env.example .env      # then set JWT_SECRET and ADMIN_EMAIL
npm start                 # http://localhost:3000
npm test                  # 9 end-to-end tests, runs in a few seconds
```

Needs Node 20 or newer. The database file is created on first start (`./data/watchcoin.db`) and filled with
the 14 starter tasks. **Sign up with the `ADMIN_EMAIL` address to get the admin account.**

## What the server enforces

| Rule | Where |
|---|---|
| Passwords hashed (bcrypt). Login timing is the same for unknown emails. | `routes/auth.js` |
| Balance only changes through one function that also writes the ledger, so `balance = sum(ledger)` always. | `services.js` |
| Task timer is measured on the server. Finishing early is rejected. | `routes/play.js` |
| Question answers are checked on the server and never sent to the app. Wrong answers forfeit that task for the day. | `routes/play.js` |
| Answers sent right after the timer ends (under 1.5 s) count as a bot, flag the account, and pay nothing. | `routes/play.js` |
| One payout per task per day. Max 5 finished tasks per hour. | `routes/play.js` |
| Premium-only tasks and the daily task cap depend on the user's active plan. | `services.js` |
| Inviter is paid once, when the friend finishes a first task. | `routes/play.js` |
| Streak, spin, and weekly challenge payouts can each be claimed once. Spin result is random on the server. | `routes/play.js` |
| Accounts per IP are capped. Rate limits on all routes, stricter on login. | `server.js`, `routes/auth.js` |
| Bans and role changes apply on the user's very next request. | `middleware.js` |

Game numbers (plan prices and caps, levels, spin prizes, bonuses, challenges) are all in `src/rules.js`.

## API

All routes are under `/api`. Send `Authorization: Bearer <token>` except where noted. Errors look like
`{ "error": "message" }`.

**Public:** `GET /health`, `GET /public/stats`, `POST /auth/signup`, `POST /auth/login`, `POST /auth/login/2fa`,
`POST /auth/reset-password`, `POST /auth/verify-email`

**Account:** `GET /me`, `/me/2fa/*` (staff two-step setup), `GET|PUT /me/prefs`, `/push/*` (phone notifications), `PATCH /me` (name, avatar, lang, onboarded), `POST /me/password`, `DELETE /me`,
`POST /auth/resend-verification`, `GET /notifications`, `POST /notifications/read`

**Earning:** `GET /tasks`, `POST /tasks/:id/start`, `POST /tasks/:id/complete` (`{ answer }`),
`GET /rewards`, `POST /rewards/streak/claim`, `POST /rewards/spin`, `GET /challenges`,
`POST /challenges/:id/claim`, `GET /achievements`

**Money and social:** `GET /wallet`, `GET /premium`, `POST /premium/upgrade`, `GET /referrals`,
`GET /leaderboard`, `GET /launch`, `POST /support`, `POST /wallet/transfer` and `POST /wallet/convert`
(both return 501 until WTC launches)

**Admin (admin role only), under `/admin`. Every change is written to the audit log:** `GET|POST /tasks`, `PATCH|DELETE /tasks/:id`, `GET /users`,
`POST /users/:id/ban`, `POST /users/:id/adjust`, `GET /upgrades`, `POST /upgrades/:id/decide`,
`GET /schedule`, `POST /schedule/copy`, `POST /tasks/bulk`, `GET /expiring`, `GET /backups`, `POST /backups/run`, `GET|POST /staff`, `POST /staff/:id/reset-2fa`, `GET /tickets`, `POST /tickets/:id/resolve`, `GET /payments` (Paystack), `GET /crypto-orders` (USDT), `GET|PUT /settings`, `GET /stats`, `GET /charts?days=7`,
`GET /export/users.csv`, `GET /users/:id` (full profile, token history, task activity, referrals), `GET /users/:id/ledger`,
`GET /audit`, `GET|POST /broadcasts`, `GET /tasks/stats`, `GET /fraud`, `GET /economics`

### Task flow the app should follow

1. `GET /tasks` shows today's list (no URLs or answers).
2. User taps Start: `POST /tasks/:id/start` returns the video `url`, `secs`, and the question with options.
3. App opens the video and runs the countdown.
4. When the countdown ends, show the question and send `POST /tasks/:id/complete` with `{ "answer": <index> }`.
   Polls skip the timer. The response contains the reward, new balance, and any bonuses or achievements.

## The frontend is included

`public/index.html` is the Watchcoin app wired to this API. Start the server and open
`http://localhost:3000`. Sign up with your `ADMIN_EMAIL` to get the Admin tab.

It saves only the login token in the browser. Balances, tasks, rewards, and plans all come from the server.

To host the frontend somewhere else (for example Netlify), upload `public/index.html` there, add this line
just above its `<script>` tag, and set `CORS_ORIGIN` on the backend to the frontend address:

```html
<script>window.WATCHCOIN_API = 'https://your-backend.example.com/api';</script>
```

## Still manual, on purpose

- **Crypto payments are automatic for USDT on TRON.** If someone pays a different amount, they send the transaction hash and an
  admin approves it with `POST /admin/upgrades/:id/decide`. The older manual instructions still work if no address is set.
- **Email.** `src/mailer.js` only prints emails to the console. Plug in a provider (Resend, SES, Postmark)
  before turning on `REQUIRE_EMAIL_VERIFICATION`.
- **Withdrawals, transfers, convert.** Not built because WTC has not launched. The wallet routes are
  stubbed with a 501 response.

## Deploy on Railway

1. Put this folder in a GitHub repository (the `.gitignore` already keeps `node_modules`, `data`, and `.env` out).
2. In Railway: **New Project, Deploy from GitHub repo**, and pick the repository. `railway.json` sets the start
   command and a health check on `/api/health`.
3. **Add a Volume** to the service (right-click the service on the canvas, or press Ctrl/Cmd+K, then "Volume") and mount it at
   `/data`. Without a volume the database is erased on every deploy. The app finds the volume by itself and
   stores `watchcoin.db` there.
4. Open **Variables** and add:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | a long random string (run `openssl rand -hex 32`) |
   | `ADMIN_EMAIL` | the email you will sign up with as admin |

   Railway sets `PORT`, the public address, and the proxy setting for you. If you use your own domain, also set
   `PUBLIC_URL` (and `CORS_ORIGIN` only if the frontend is hosted on a different address).
5. In **Settings, Networking**, press **Generate Domain**, open it, and sign up with your `ADMIN_EMAIL`.
6. Keep the service at **one replica**. SQLite lives in one file and cannot be shared between two servers.
   Turn on Railway's volume backups, and sign up as admin first, because anyone who guesses the address can
   register right after you deploy.

## Task cover pictures

The admin picks a picture when adding a video or task. The dashboard shrinks it to a small 16:9 JPEG before sending it. JPEG, PNG
and WebP are accepted (no SVG, which can carry scripts). The server keeps the picture and hands the app a short link such as
`/api/covers/12?v=3`, so the task list stays small and browsers keep each picture for a week. The link changes when the picture
does, so people never see an old one. Hidden tasks stop serving their picture.

## Backups, alerts and restoring

Every day the server makes a consistent copy of the whole database (users, balances, payments), compresses it, optionally
encrypts it, keeps the newest 7 on its own disk, and copies it to S3-compatible storage if you set that up. The **System** page
in the admin dashboard shows the last backup and has a **Back up now** button.

**Set up the copy in another place.** Backups on the server's own disk do not help if that disk is lost. Create a bucket at
Cloudflare R2, Backblaze B2 or Amazon S3 and set these on the backend:

```
BACKUP_S3_BUCKET=watchcoin-backups
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
BACKUP_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com    # leave empty for Amazon S3
BACKUP_S3_REGION=auto                                           # for Amazon S3, your region, such as eu-west-1
BACKUP_PASSPHRASE=a long phrase only you know                    # encrypts every backup
```

Use a **passphrase** (backups hold email addresses and password hashes), and keep it somewhere safe. **Without it an encrypted
backup cannot be opened.** Set a lifecycle rule on the bucket to delete copies older than, say, 60 days.

**Alerts.** Set `ALERT_WEBHOOK_URL` to a Slack or Discord "incoming webhook" address. You are then messaged when a backup fails,
no backup has worked for a day and a half, the server hits an error, USDT checking keeps failing, or a payment needs review. The
same alert is sent at most once every 10 minutes. To be told when the **whole site is down**, add a free monitor (UptimeRobot or
Better Stack) pointed at `https://YOUR-BACKEND/api/health`, which also checks the database answers.

**Restoring.** Do this on your computer first, to prove a backup works:

```bash
BACKUP_PASSPHRASE='your phrase' node scripts/restore-backup.js watchcoin-20261015-030004.db.gz.enc restored.db
BACKUP_S3_BUCKET=... BACKUP_S3_ACCESS_KEY_ID=... BACKUP_S3_SECRET_ACCESS_KEY=... BACKUP_PASSPHRASE=... \
  node scripts/restore-backup.js --from-s3 watchcoin/watchcoin-20261015-030004.db.gz.enc restored.db
```

It writes the database, runs an integrity check, and tells you how many users it holds. To go live from a backup, stop the app,
move the old database file away, put the restored file where `DB_PATH` points, and start the app again.

## Two-step sign-in and the support role

Admin and support accounts sign in with a password **and** a 6-digit code from an authenticator app. It is on by default in
production (`REQUIRE_STAFF_2FA=false` turns it off). The first time, the dashboard shows a QR code to scan, asks for a code, and
gives 10 single-use **recovery codes**. Each code works once and is only ever shown that one time.

- **Roles.** `admin` can do everything. `support` can look up users (with their token history), payments and tickets, see the
  schedule and tasks, and resolve tickets. Support cannot adjust balances, ban, approve payments, change settings, edit tasks, send
  announcements, or see totals. Admins manage the team on the **Team** page: add support people (they must already have an
  account), remove them, or reset their two-step sign-in if they lose a phone. The `ADMIN_EMAIL` account is always the admin.
- **If the admin is locked out** (lost phone and recovery codes), run on the server: `node scripts/reset-2fa.js you@example.com`,
  then sign in and set it up again.
- Codes can be used only once, wrong codes are limited to 5 attempts, and a half-finished sign-in cannot be used as a session.

## Reminders, email and phone notifications

- **Plan ending.** Premium members are told 3 days before, 1 day before, and just after a plan ends, once each. They get an in-app
  notice, a phone notification and an email (each can be turned off in the Me tab). The app also shows a Renew banner, and the
  admin sees the same list under Upgrades.
- **Daily nudges** (phone only): at 08:00 "your tasks are ready" for people who have not started, and at 18:00 "your streak ends
  tonight" for people with a streak who have not claimed. Times are in server time and can be changed with `PUSH_TASKS_HOUR` and
  `PUSH_STREAK_HOUR`. Each is sent at most once a day.
- **Email.** Set `RESEND_API_KEY` (from resend.com) and `MAIL_FROM` (an address on a domain you have verified with Resend). Without
  them, emails are only printed in the log. This also turns on the signup verification emails.
- **Installable app and notifications.** The app can be added to the home screen (Android and desktop: an Install button in the
  Me tab; iPhone: Share, then Add to Home Screen, which is also needed before notifications work there). Notification keys are
  created automatically the first time and kept in the database. **They are part of the backup**, so restoring keeps phones
  signed up. An admin can also tick "send to phones" when sending an announcement.
- Notifications need the site to be served over **https** (Railway does this).

## Bulk adding tasks

On **Videos & tasks**, press **Bulk add**, paste one task per line, and choose when they appear: spread over days (for example
5 a day starting Monday, skipping weekends), the same days for all, or every day. Each line is checked first, and nothing is saved
unless every line is fine. For Watch tasks each line is `link | title | question | options | correct number | reward`. For Like and
Subscribe it is `link | title | reward`. On the **Schedule** page, **Copy this day** repeats a day's tasks onto other days.

## Daily tasks and scheduling

Each task is either **Every day** or set for **chosen dates**. In the admin dashboard, pick the dates on a calendar when you add
a task, so you can plan a week or a month in one go. Each day, people see only the tasks set for that day, plus any set to
"Every day", so the list changes daily. The **Schedule** page shows the next six weeks and marks days with fewer than 5 tasks for
free users.

- Tasks picked for today come first, then the every-day ones. The plan decides how many a person sees (5, 10, 20 or 40), and
  premium-only tasks show only to subscribers.
- A task set for several dates can be done again on each of those dates.
- A day starts at midnight in the server's time (`TZ_OFFSET_MINUTES`, which is 0 for Ghana).
- Tasks that existed before scheduling keep showing every day until you change them.
- Everyone is told about a new task only if it is available today. Tasks planned for later appear on their day without a notice.

## Take payments with Paystack

At checkout, people choose how to pay:

- **Card or mobile money**, through [Paystack](https://paystack.com). Payments are checked and the plan starts on its own.
- **Crypto (USDT on the TRON network)**. The person gets an exact amount and your address, sends it, and the plan starts
  on its own when the payment is detected. See "Take USDT payments" below.

Each option appears only when it is set up. With just one set up, the checkout shows only that one.

1. Create a Paystack account and open **Settings, API Keys and Webhooks**. Copy your **Test** secret key (`sk_test_...`).
2. On the backend service, set `PAYSTACK_SECRET_KEY` to that key. Set `PAYSTACK_CURRENCY` to your account's currency
   (Ghana uses `GHS`). If the app is hosted on a different address from the backend, also set `FRONTEND_URL`.
3. Redeploy, then in Paystack set **Webhook URL** to `https://YOUR-BACKEND/api/webhooks/paystack`. The admin dashboard shows
   this address in Settings.
4. In the admin dashboard, open **Settings** and enter the **exchange rate** (how many GHS equal 1 USDT). Plan prices are set
   in USDT, so this sets what customers pay. Paystack stays off for customers until you enter a rate.
5. Pay for a plan yourself with Paystack's test cards or test mobile money numbers, and check that the plan starts.
6. When you are happy, switch `PAYSTACK_SECRET_KEY` to your **Live** key.

How it stays safe:

- The secret key lives only in the server's environment. It never reaches the app.
- Paystack's signed webhook is checked (HMAC-SHA512 on the exact bytes), and then **every payment is confirmed again
  directly with Paystack** before a plan starts. A forged message cannot give anyone a plan.
- The amount and currency Paystack reports must match what the server asked for. A payment that does not match is held as
  "Needs review" in the dashboard and gives no plan.
- A payment is applied once, however many times it is reported. Renewing the same plan adds 30 days.
- People are sent back to the app after paying, and the plan shows straight away. If they close the page instead, the
  webhook still starts the plan.

Not built: refunds (do them in your Paystack dashboard, then end the plan by hand if needed) and automatic renewals. Each
payment buys 30 days. Prices change when you change the exchange rate, so check it from time to time.

## Take USDT payments (TRON network, TRC20)

Premium plans can be paid in USDT, and the plan starts by itself once the payment arrives.

1. In the admin dashboard, open **Settings, USDT payments** and enter the TRON address that should receive USDT (it starts
   with `T`). Use a wallet that only you control. Customers see this address, and anyone can look at its payments on the
   network.
2. Optional but recommended: create a free API key at [TronGrid](https://www.trongrid.io) and set `TRONGRID_API_KEY` on the
   backend. Without a key, the public limits are lower.
3. Send a small test payment yourself: choose Crypto (USDT) at checkout for a plan, send the exact amount shown, and watch the
   plan start. The dashboard's **USDT payments** page lists every order.

How it works, and why it is safe:

- Each order gets its **own exact amount**, such as 5.0042 USDT (the plan price plus a few hundredths of a cent), good for
  60 minutes. The server looks at **confirmed** USDT transfers into your address. A transfer counts only if it is for exactly
  that amount, into your address, in the real USDT contract (`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`), made after the order was
  created. That means nobody can claim someone else's payment, and a fake token does not count.
- The server checks every 30 seconds in the background, and also when the app asks, so plans start even if the person closed the
  app.
- A payment that arrives after the 60 minutes still counts for 24 hours. After that, the order closes.
- Each transaction can pay only one order, and a plan starts only once.
- If someone sent a different amount (for example an exchange took a withdrawal fee), they can paste the transaction hash.
  It appears on the **Upgrades** page for you to check and approve by hand.

Things to know:

- The payment screen shows the exact amount, the address with a one-tap copy, and a QR code of the address for wallet apps. The QR
  library (`public/qr.js`) is the MIT-licensed `qrcode-generator` by Kazuhiko Arase, included as one file.
- Only USDT on the **TRON (TRC20)** network is supported. Money sent on another network, or in another coin, cannot be
  matched, and you would have to sort it out by hand.
- The checker needs TronGrid to be reachable. If it is down, orders stay waiting and are matched once it is back.
- Refunds are not built. Send money back from your wallet if you need to.
- The background checker runs inside the one backend server, which is how this project is set up to run on Railway.

## Before you go live

1. Set a long random `JWT_SECRET`, set `NODE_ENV=production`, and set `CORS_ORIGIN` to your site address.
2. Serve over HTTPS (any host does this for you) and set `TRUST_PROXY=true` if there is a proxy in front.
3. Keep `./data` on a persistent disk and back it up daily. SQLite handles a few thousand active users on one
   server. Past that, move to Postgres and keep the same table layout.
4. Check the economics. At the starting price, the task rewards pay more than premium plans cost. Review
   `STARTERS` in `src/db.js` and `PLANS` in `src/rules.js`.
5. Have the terms, privacy policy, and local rules for paying people in tokens reviewed by a lawyer.
