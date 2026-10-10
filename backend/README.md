# Watchcoin backend

Node.js + Express + SQLite API for the Watchcoin task-and-earn app. The server decides everything that
touches tokens: whether a task was really watched, whether an answer is right, how much is paid, and who
may see premium tasks. The browser can no longer edit its own balance.

## Run it

```bash
npm install
cp .env.example .env      # then set JWT_SECRET, ADMIN_EMAIL and ADMIN_SETUP_CODE
npm start                 # http://localhost:3000
npm test                  # 17 end-to-end tests, runs in a few seconds
```

Needs Node 20 or newer. The database file is created on first start (`./data/watchcoin.db`) and filled with
the 14 starter tasks. Databases from version 1.0 are upgraded automatically on start, and the old admin becomes the owner.

### Becoming the owner

The owner runs everything, and there is only one. To claim it:

1. Set `ADMIN_EMAIL` (your email) and `ADMIN_SETUP_CODE` (a long random string, e.g. `openssl rand -hex 16`).
2. Sign up in the app with that email.
3. Open the admin dashboard, sign in, and enter the setup code when asked. You are now the owner.
4. Turn on two-step login (the dashboard asks you to). You can then remove `ADMIN_SETUP_CODE`.

The code only works while there is no owner, so nobody can use it after you. If you can't use the dashboard,
run `npm run make-owner -- you@example.com` in a shell on the server instead.

In development only (`NODE_ENV` not `production`), leaving `ADMIN_SETUP_CODE` empty keeps the old behaviour: whoever
signs up with `ADMIN_EMAIL` becomes the owner.

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
| Changing or resetting a password, a ban, a role change, or "log out everywhere" signs out every old login. | `middleware.js` |
| The hourly limit, plan access and task budget are checked again when a task is finished. | `routes/play.js` |
| Staff roles (support, admin, owner) limit what each person can do in the admin area. | `roles.js`, `routes/admin.js` |
| Staff need two-step login (authenticator app codes, 10 backup codes, lockout after 5 wrong codes). Staff logins expire after 12 hours. | `totp.js`, `mfa.js`, `routes/security.js` |
| Paystack payments switch the plan on only when the signed webhook (or a check with Paystack) shows the exact amount was paid. | `paystack.js` |

Game numbers (plan prices and caps, levels, spin prizes, bonuses, challenges) are all in `src/rules.js`.

## API

All routes are under `/api`. Send `Authorization: Bearer <token>` except where noted. Errors look like
`{ "error": "message" }`.

**Public:** `GET /health`, `GET /public/stats`, `POST /auth/signup`, `POST /auth/login`,
`POST /auth/reset-password`, `POST /auth/verify-email`

**Login with two-step:** when `POST /auth/login` returns `{ twoFactorRequired: true, challenge }`, send
`POST /auth/login/2fa` with `{ challenge, code }` (a 6-digit code or a backup code) to get the token.
`POST /auth/reset-password` can return the same. `POST /auth/claim-owner` (`{ setupCode }`) makes the signed-in account the owner.

**Account:** `GET /me`, `PATCH /me` (name, avatar, lang, onboarded), `POST /me/password` (returns a new token), `DELETE /me`,
`POST /auth/resend-verification`, `GET /notifications`, `POST /notifications/read`

**Security:** `GET /me/2fa`, `POST /me/2fa/setup` (`{ password }`, returns a QR code), `POST /me/2fa/enable` (`{ code }`, returns
backup codes and a new token), `POST /me/2fa/disable` (`{ password, code }`), `POST /me/2fa/backup-codes` (`{ code }`), `POST /me/logout-all`

**Earning:** `GET /tasks`, `POST /tasks/:id/start`, `POST /tasks/:id/complete` (`{ answer }`),
`GET /rewards`, `POST /rewards/streak/claim`, `POST /rewards/spin`, `GET /challenges`,
`POST /challenges/:id/claim`, `GET /achievements`

**Money and social:** `GET /wallet`, `GET /premium`, `POST /premium/upgrade` (manual payment), `POST /premium/checkout`
(`{ plan }`, returns a Paystack `authorizationUrl`), `GET /premium/checkout/:reference`, `GET /referrals`,
`GET /leaderboard`, `GET /launch`, `POST /support`, `POST /wallet/transfer` and `POST /wallet/convert`
(both return 501 until WTC launches)

**Webhooks (no login, signed by the provider):** `POST /webhooks/paystack`

**Admin, under `/admin`. Every change is written to the audit log.** The lowest role for each route:

| Role | Routes |
|---|---|
| support | `GET /stats`, `GET /charts?days=7`, `GET /users`, `GET /users/:id`, `GET /users/:id/ledger`, `GET /tasks`, `GET /tasks/stats`, `GET /upgrades`, `GET /payments`, `GET /tickets`, `POST /tickets/:id/resolve` |
| admin | `POST /tasks`, `PATCH\|DELETE /tasks/:id`, `POST /users/:id/ban`, `POST /users/:id/logout`, `POST /upgrades/:id/decide`, `POST /payments/:id/recheck`, `POST /payments/:id/approve`, `GET\|POST /broadcasts`, `GET /fraud`, `GET /economics`, `GET /audit`, `GET /staff`, `GET /settings` |
| owner | `POST /users/:id/adjust`, `POST /users/:id/role` (`{ role: user\|support\|admin }`), `POST /users/:id/reset-2fa`, `PUT /settings` (including `fxRate`), `GET /export/users.csv` |

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

## Online payments with Paystack

Users pick a plan, tap **Pay with Mobile Money or card**, pay on Paystack's page, and come back with the plan already on.
The manual option (send money, type a reference, an admin approves) stays available next to it.

1. Create a Paystack account and finish its business verification (needed before you can take live payments).
2. Set `PAYSTACK_SECRET_KEY` (start with the `sk_test_` key), `PAYSTACK_CURRENCY` (default `GHS`) and `PAYSTACK_FX_RATE`
   (how many cedis 1 USDT costs). Plans are priced in USDT and charged in your currency at that rate. The owner can change the
   rate later in the dashboard's Settings.
3. In Paystack, **Settings > API Keys & Webhooks**, set the webhook URL to `https://your-backend-address/api/webhooks/paystack`.
4. Make sure `PUBLIC_URL` is the address of the user app, because Paystack sends people back there after paying.
5. Test with Paystack's test cards and test mobile money numbers, then switch to the `sk_live_` key.

How it stays safe: the webhook is accepted only with a valid Paystack signature, and a plan switches on only if the amount and
currency paid match what was asked. A wrong amount is held for an admin in **Online payments**. Paystack retries webhooks, and
repeats are ignored. If the webhook is slow, the app checks with Paystack when the user comes back.

Moving up to a bigger plan keeps the value of the days left: 15 unused days of Plus ($5) become 5 extra days on Pro ($15).

## Still manual, on purpose

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
   | `ADMIN_EMAIL` | the email you will sign up with as owner |
   | `ADMIN_SETUP_CODE` | a long random string (run `openssl rand -hex 16`); see "Becoming the owner" |
   | `PAYSTACK_SECRET_KEY`, `PAYSTACK_FX_RATE` | optional, for online payments (see "Online payments with Paystack") |

   Railway sets `PORT`, the public address, and the proxy setting for you. If you use your own domain, also set
   `PUBLIC_URL` (and `CORS_ORIGIN` only if the frontend is hosted on a different address).
5. In **Settings, Networking**, press **Generate Domain**, open it, sign up with your `ADMIN_EMAIL`, and claim the owner role.
6. Keep the service at **one replica**. SQLite lives in one file and cannot be shared between two servers.
   Turn on Railway's volume backups. Nobody else can become the owner without `ADMIN_SETUP_CODE`.

## Before you go live

1. Set a long random `JWT_SECRET` (and `DATA_KEY`), set `NODE_ENV=production`, and set `CORS_ORIGIN` to your site address.
   Claim the owner role and turn on two-step login before you share the address.
2. Serve over HTTPS (any host does this for you) and set `TRUST_PROXY=true` if there is a proxy in front.
3. Keep `./data` on a persistent disk and back it up daily. SQLite handles a few thousand active users on one
   server. Past that, move to Postgres and keep the same table layout.
4. Check the economics. At the starting price, the task rewards pay more than premium plans cost. Review
   `STARTERS` in `src/db.js` and `PLANS` in `src/rules.js`.
5. Have the terms, privacy policy, and local rules for paying people in tokens reviewed by a lawyer.
