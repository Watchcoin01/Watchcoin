# Watchcoin admin dashboard

A separate web app for running Watchcoin. It is **not** part of the user app or the backend. It is its own
project with its own address, and it only talks to the backend through the `/api/admin` routes. Only accounts
with a staff role (support, admin or owner) can sign in, and the backend enforces that on every request.

No build step and no dependencies. A small Node server (`server.js`) serves the files and adds security
headers.

## Pages

| Page | What you can do |
|---|---|
| Overview | Totals, charts for 7, 14, or 30 days, and shortcuts to anything that needs attention |
| Economics | Premium revenue against tokens issued, and where the tokens came from |
| Task performance | For every task: starts, completion rate, wrong-answer rate, average time, and tokens paid |
| Tasks | Add, edit, hide, and reorder tasks. Set rewards, questions, premium-only, double rewards, and budgets |
| Users | Search and filter. Open any user for their full token history, task activity, referrals, payments, and support requests |
| Fraud checks | Accounts that signed up from the same network, accounts answering too fast, and people inviting from their own network |
| Upgrades | Approve or reject manual premium payments after you confirm the money arrived |
| Online payments | Paystack payments (Mobile Money and cards): paid, not finished, failed, and wrong amounts waiting for a check |
| Support | Read and resolve user problem reports |
| Announcements | Send a notification to everyone, premium members, or free users |
| Staff | Who has which role and whether their two-step login is on. The owner adds staff, changes roles, and resets a lost phone |
| Audit log | Every change and every staff sign-in, with who did it and when |
| Settings | Payment details, launch date, token price, the Paystack exchange rate, and a users CSV download |
| My security | Two-step login (QR code setup, backup codes), change password, sign out everywhere |

Each person only sees the pages their role allows: **support** sees users, stats, payments and support requests; **admin** also
manages tasks, bans, upgrades, announcements, fraud checks, economics and the audit log; the **owner** can also change balances,
settings and staff roles.

## Run it

```bash
cp .env.example .env     # set API_URL
npm start                # http://localhost:4000
```

`API_URL` is the address of your Watchcoin backend **including `/api`**, for example
`https://your-backend.up.railway.app/api`.

**First sign-in (becoming the owner):** sign up in the user app with the email you set as `ADMIN_EMAIL` on the backend, then
sign in here. The dashboard asks for the setup code (`ADMIN_SETUP_CODE` on the backend). Enter it to become the owner. Then set up
two-step login: scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password) and
save the 10 backup codes somewhere safe.

**Adding staff:** they sign up in the user app, you add them on the Staff page, and they sign in here and set up two-step login.

## Allow the dashboard on the backend

The browser only lets the dashboard call the backend if the backend allows its address. On the **backend**
service, set:

```
CORS_ORIGIN=https://your-admin.up.railway.app
```

Use the exact address with no trailing slash. To allow more than one address, separate them with commas.

## Deploy on Railway (as its own service)

1. Push this folder to its own GitHub repository (or use a monorepo and set the service's **Root Directory**
   to this folder).
2. In Railway, add a new service from that repository. `railway.json` sets the start command and health check.
3. Add the variable `API_URL` (your backend address plus `/api`).
4. Press **Generate Domain**, then copy that address into the backend's `CORS_ORIGIN` as shown above.
   Redeploy the backend, then open the dashboard.

You can also put it on any static host, but then you lose the security headers and the `API_URL` setting that
`server.js` provides.

## Security notes

- The login token is kept in `sessionStorage`, so it is gone when the tab closes. Staff logins also expire after 12 hours.
- Two-step login is required for every staff account in production. Five wrong codes lock the account for 15 minutes.
- The server sends a strict Content-Security-Policy, blocks framing, and tells search engines not to index.
- Everything shown from the database is escaped before it is put on the page.
- Use a unique, strong password (at least 10 characters) for staff accounts, and do not share the dashboard address publicly.
- For more protection, put the dashboard behind your host's access controls (for example an IP allowlist).

## Not in the dashboard yet

- The fraud page shows signals only. A shared network is not proof of cheating.
- Fonts (Playfair Display and DM Sans) are hosted inside this project, so the strict security policy needs no outside sources.
