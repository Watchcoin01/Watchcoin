# Watchcoin: deploy on Railway

This folder holds two apps. On Railway they run as **two services in one project**:

| Folder | Railway service name | What it is |
|---|---|---|
| `backend/` | `backend` | The API, the database, **and the user app** (the website your users open) |
| `admin/` | `admin` | The admin dashboard, for you and your staff only |

You will end up with two web addresses: one for users (the backend) and one for the dashboard (the admin).
Budget about 20 minutes.

---

## Before you start

Have these ready:

- A **GitHub** account and a **Railway** account (sign in to Railway with GitHub to keep it simple).
- **Three long random strings.** They are passwords for the server itself. Make them on a password generator
  (40+ letters and numbers, no spaces) or ask Claude for fresh ones. Call them:
  - `JWT_SECRET`: signs everyone's logins
  - `DATA_KEY`: encrypts two-step login secrets
  - `ADMIN_SETUP_CODE`: one-time code that makes you the owner

  Keep them in a password manager. Never put them in GitHub.
- The **email address** you will use as the owner.

---

## Step 1. Put the code on GitHub

1. On GitHub, click **New repository**. Name it `watchcoin`, choose **Private**, and create it.
2. On the empty repository page, click **uploading an existing file**.
3. Drag in **everything inside this folder**: the `backend` and `admin` folders and the `.gitignore` file.
   (If your computer hides files starting with a dot, that's fine; they are optional.)
4. Click **Commit changes**.

Check that the repository shows `backend/` and `admin/` at the top level, with no `node_modules` folder.

---

## Step 2. Create the backend service

1. In Railway, click **New Project**, then **Deploy from GitHub repo**, and pick `watchcoin`.
   Railway may try to build straight away and fail, because the code is in subfolders. That's expected.
2. Click the new service. In **Settings**:
   - **Service name:** rename it to `backend` (exactly, lowercase; the admin uses this name to find it).
   - **Source, Root Directory:** set to `/backend`.
3. **Add a volume** (this keeps your database safe between deploys): right-click the service on the project canvas
   (or press Ctrl/Cmd+K and type "volume"), choose **Attach volume**, and set the mount path to `/data`.
   **Without a volume, every deploy erases all users and balances.**
4. **Settings, Networking:** click **Generate Domain**. This is your users' address, e.g.
   `backend-production-xxxx.up.railway.app`. You can add your own domain later.
5. **Variables:** add these (use **Raw Editor** to paste them all at once, then fill in your values):

   ```
   NODE_ENV=production
   JWT_SECRET=paste-your-first-random-string
   DATA_KEY=paste-your-second-random-string
   ADMIN_EMAIL=you@example.com
   ADMIN_SETUP_CODE=paste-your-third-random-string
   CORS_ORIGIN=https://${{admin.RAILWAY_PUBLIC_DOMAIN}}
   MAX_ACCOUNTS_PER_IP=10
   TZ_OFFSET_MINUTES=0
   ```

   `CORS_ORIGIN` lets the dashboard talk to the backend. The `${{admin...}}` part fills itself in once the admin
   service exists (Step 3). `MAX_ACCOUNTS_PER_IP` is 10 because many people in Ghana share one mobile network address;
   lower it if you see abuse.

Railway sets `PORT`, the public address and the proxy settings by itself. The app finds the volume by itself too.

---

## Step 3. Create the admin service

1. In the same project, click **Create** (or **+ New**), then **GitHub Repo**, and pick `watchcoin` again.
2. In the new service's **Settings**:
   - **Service name:** `admin`
   - **Source, Root Directory:** `/admin`
   - **Networking:** click **Generate Domain**. This is your dashboard address. Don't share it publicly.
3. **Variables:**

   ```
   API_URL=https://${{backend.RAILWAY_PUBLIC_DOMAIN}}/api
   ```

4. Deploy both services (Railway shows a **Deploy** button when variables change). Wait until both are green.

**If the `${{...}}` references don't fill in** (for example because the services have other names), paste the real
addresses instead: `API_URL=https://<backend address>/api` on admin, and `CORS_ORIGIN=https://<admin address>` on
backend. No slash at the end.

---

## Step 4. Check it works

1. Open `https://<backend address>/api/health`. You should see `{"ok":true,...}`.
2. Open `https://<backend address>`. You should see the Watchcoin app.
3. Open `https://<admin address>`. You should see the dashboard sign-in.

---

## Step 5. Become the owner (do this right away)

1. In the **user app**, sign up with your `ADMIN_EMAIL`. Save the recovery code it shows.
2. In the **dashboard**, sign in with the same email and password. It says "Not a staff account": enter your
   `ADMIN_SETUP_CODE` and click **Become the owner**.
3. The dashboard asks you to turn on **two-step login**. Scan the QR code with Google Authenticator, Microsoft
   Authenticator, Authy or 1Password, enter the code, and **save the 10 backup codes** somewhere safe.
4. Back in Railway, delete the `ADMIN_SETUP_CODE` variable on the backend. It can't be used again anyway, but
   there's no reason to keep it.

---

## Step 6. Set up the app

In the dashboard:

- **Settings:** add your **payment details** (e.g. your MoMo number) for manual premium payments, and the launch date.
- **Videos & tasks:** the app starts with 14 placeholder tasks. Replace them with your real YouTube videos and questions.
- **Staff:** to add helpers, have them sign up in the app first, then add them here as Support or Admin.

---

## Optional: online payments with Paystack

Lets users pay for premium with Mobile Money or card, and turns the plan on automatically.

1. Create a Paystack account and complete its business verification.
2. On the **backend** service, add these variables (start with the test key):

   ```
   PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxx
   PAYSTACK_CURRENCY=GHS
   PAYSTACK_FX_RATE=15.5
   ```

   `PAYSTACK_FX_RATE` is how many cedis 1 USDT costs. You can change it later in the dashboard's Settings.
3. In Paystack, **Settings, API Keys & Webhooks**, set the **webhook URL** to
   `https://<backend address>/api/webhooks/paystack`.
4. Test a payment with Paystack's test Mobile Money numbers. When it works, switch to your `sk_live_` key.

---

## Keeping it running

- **Backups:** on the backend's volume, turn on Railway's **volume backups**. Your whole app lives in that one database file.
- **One copy only:** keep the backend at **1 replica**. The database can't be shared between copies.
- **Updates:** change files on GitHub and Railway redeploys the service whose folder changed. Users and balances stay,
  because they live on the volume.
- **Locked out of the dashboard?** Use a backup code. If those are gone too, open a shell on the backend service in
  Railway and run `npm run make-owner -- you@example.com` after the owner resets two-step login; or contact whoever has owner access.
- **Logs:** each service's **Deployments** tab shows its logs. The backend prints a short status when it starts.

## Not included yet

- **Email:** the app doesn't send emails yet (`backend/src/mailer.js`). Password resets use the recovery code shown at sign-up.
- **Withdrawals, transfers and convert** show "coming soon" until WTC launches.
- Have the terms, privacy policy and the rules for paying people in tokens checked by a lawyer in your country before launch.

More detail: `backend/README.md` (API, rules, security) and `admin/README.md` (dashboard pages and roles).
