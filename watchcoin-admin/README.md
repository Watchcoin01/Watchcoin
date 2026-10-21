# Watchcoin admin dashboard

A separate web app for running Watchcoin. It is **not** part of the user app or the backend. It is its own
project with its own address, and it only talks to the backend through the `/api/admin` routes. Only accounts
with the admin role can sign in, and the backend enforces that on every request.

No build step and no dependencies. A small Node server (`server.js`) serves the files and adds security
headers.

## Pages

| Page | What you can do |
|---|---|
| Overview | Totals, charts for 7, 14, or 30 days, and shortcuts to anything that needs attention |
| Economics | Premium revenue against tokens issued, and where the tokens came from |
| Task performance | For every task: starts, completion rate, wrong-answer rate, average time, and tokens paid |
| Tasks | Add, edit, hide, and reorder tasks, or **bulk add** from a pasted list. Set rewards, questions, premium-only, double rewards, budgets, and the dates each task appears on |
| Schedule | The next six weeks at a glance. Days with too few tasks are red. Click a day to see, add, remove, or copy its tasks |
| Users | Search and filter. Open any user for their full token history, task activity, referrals, payments, and support requests |
| Fraud checks | Accounts that signed up from the same network, accounts answering too fast, and people inviting from their own network |
| Upgrades | Approve payments that need a human check, and see which plans are about to end |
| Payments | Every Paystack payment, with anything that needs review highlighted |
| USDT payments | Every USDT order on the TRON network, with a link to each transaction on Tronscan |
| Support | Read and resolve user problem reports |
| Announcements | Send a notification to everyone, premium members, or free users, and optionally buzz their phones |
| Audit log | Every change made from the dashboard, with who did it and when |
| Team | Add or remove support people, and reset a person's two-step sign-in |
| System | Backups: last backup, the other-place copy, encryption, alerts, and a Back up now button |
| Security | Your own two-step sign-in and recovery codes |
| Settings | Paystack connection and exchange rate, your USDT receiving address, launch date, token price, and a users CSV download |

## Run it

```bash
cp .env.example .env     # set API_URL
npm start                # http://localhost:4000
```

`API_URL` is the address of your Watchcoin backend **including `/api`**, for example
`https://your-backend.up.railway.app/api`.

Sign in with the account whose email you set as `ADMIN_EMAIL` on the backend.

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

## Two-step sign-in and roles

Everyone on the team signs in with their password and a 6-digit code from an authenticator app (on by default when the backend runs
in production). The first sign-in walks you through it and gives you 10 recovery codes. **Support** people see a read-only view of
users, payments, tickets, the schedule and tasks, and can resolve tickets. They cannot move money or change settings. Admins add
them on the Team page. The backend enforces all of this, so hiding a button is never the only protection.

## Security notes

- The login token is kept in `sessionStorage`, so it is gone when the tab closes.
- The server sends a strict Content-Security-Policy, blocks framing, and tells search engines not to index.
- Everything shown from the database is escaped before it is put on the page.
- Use a unique, strong password for the admin account, and do not share the dashboard address publicly.
- For more protection, put the dashboard behind your host's access controls (for example an IP allowlist).

## Not in the dashboard yet

- Roles other than admin. Everyone with the admin role can do everything.
- The fraud page shows signals only. A shared network is not proof of cheating.
- Fonts (Playfair Display and DM Sans) are hosted inside this project, so the strict security policy needs no outside sources.
