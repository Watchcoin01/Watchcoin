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

**Public:** `GET /health`, `GET /public/stats`, `POST /auth/signup`, `POST /auth/login`,
`POST /auth/reset-password`, `POST /auth/verify-email`

**Account:** `GET /me`, `PATCH /me` (name, avatar, lang, onboarded), `POST /me/password`, `DELETE /me`,
`POST /auth/resend-verification`, `GET /notifications`, `POST /notifications/read`

**Earning:** `GET /tasks`, `POST /tasks/:id/start`, `POST /tasks/:id/complete` (`{ answer }`),
`GET /rewards`, `POST /rewards/streak/claim`, `POST /rewards/spin`, `GET /challenges`,
`POST /challenges/:id/claim`, `GET /achievements`

**Money and social:** `GET /wallet`, `GET /premium`, `POST /premium/upgrade`, `GET /referrals`,
`GET /leaderboard`, `GET /launch`, `POST /support`, `POST /wallet/transfer` and `POST /wallet/convert`
(both return 501 until WTC launches)

**Admin (admin role only), under `/admin`. Every change is written to the audit log:** `GET|POST /tasks`, `PATCH|DELETE /tasks/:id`, `GET /users`,
`POST /users/:id/ban`, `POST /users/:id/adjust`, `GET /upgrades`, `POST /upgrades/:id/decide`,
`GET /tickets`, `POST /tickets/:id/resolve`, `GET /payments` (Paystack), `GET|PUT /settings`, `GET /stats`, `GET /charts?days=7`,
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

- **Crypto payments are confirmed by hand.** Users send USDT and paste the transaction hash. An admin checks it and approves
  with `POST /admin/upgrades/:id/decide`. Paystack (above) handles card and mobile money automatically.
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

## Take payments with Paystack

At checkout, people choose how to pay:

- **Card or mobile money**, through [Paystack](https://paystack.com). Payments are checked and the plan starts on its own.
- **Crypto (USDT)**. The person sends USDT to the address you set in the dashboard (Settings, Crypto payment details),
  pastes the transaction hash, and you approve it on the Upgrades page after you see the money arrive.

Each option appears only when it is set up. With just one set up, the checkout shows only that one. Crypto payments are
not checked automatically yet.

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

## Before you go live

1. Set a long random `JWT_SECRET`, set `NODE_ENV=production`, and set `CORS_ORIGIN` to your site address.
2. Serve over HTTPS (any host does this for you) and set `TRUST_PROXY=true` if there is a proxy in front.
3. Keep `./data` on a persistent disk and back it up daily. SQLite handles a few thousand active users on one
   server. Past that, move to Postgres and keep the same table layout.
4. Check the economics. At the starting price, the task rewards pay more than premium plans cost. Review
   `STARTERS` in `src/db.js` and `PLANS` in `src/rules.js`.
5. Have the terms, privacy policy, and local rules for paying people in tokens reviewed by a lawyer.
