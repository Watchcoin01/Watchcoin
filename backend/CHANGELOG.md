# Changelog

## 1.4.2

- **The prize wheel now spins on phones.** Many phones have animations switched off ("Reduce motion" on iPhone, "Remove
  animations" or battery saver on Android), and a rule in the page turned off every animation for them, so the wheel jumped
  straight to the prize. The wheel is now exempt from that rule. People who asked for less motion get a shorter, gentler
  spin (2 seconds, 3 turns) instead of a frozen wheel; everyone else still gets the full 4-second spin. Tests added.

## 1.4.1 (security update)

- **Admin dashboard no longer crashes on a bad address.** Opening a malformed address such as `/%` stopped the whole admin
  server, and Railway gives up restarting after 5 crashes, so anyone could take the dashboard offline. Bad addresses now get
  a normal 400 reply, and one failing request can never stop the server. (`admin/server.js`, with tests.)
- **Forgetting `NODE_ENV` is no longer dangerous.** Without it the server used a publicly known development secret, which
  would let anyone forge a login for any account, including the owner. Running on Railway now counts as production, so the
  server refuses to start without a real `JWT_SECRET`. In production the secret must be at least 32 characters
  (`openssl rand -hex 32`); `DATA_KEY`, if set, must be too.
- **Wrong guesses are now limited per account, not only per network.** 10 wrong passwords lock that account's login for
  15 minutes; 5 wrong recovery codes lock password reset for an hour. A correct login clears the count. Unknown emails are
  treated the same, so the limit reveals nothing. (`src/attempts.js`)
- **Login tokens are pinned to HS256**, so a token can never pick its own signing method.
- **Passwords must be 8 to 72 characters** (was 6 to 100; bcrypt ignores everything after 72). Staff still need 10.
  Existing accounts with shorter passwords can still sign in; the rule applies to new and changed passwords.
- **Task cover images** must be PNG, JPEG, WebP or GIF. SVG is refused. The dashboard already converts covers to JPEG.
- **CSV export** also defuses cells that start with a tab or carriage return.

## 1.4.0

- **Real video clips for the wheel animals.** The dashboard has a new **Wheel animals** page (admin role) where you upload a
  short MP4 or WebM for each animal, for example a cinematic fire-breathing dragon made with an AI video tool. Each animal has
  a ready-made prompt to copy. When someone wins, the app plays that clip full screen, with sound where the phone allows,
  plus the screen shake, vibration, coin burst and prize counter. Animals without a clip keep the built-in animation, and so
  does any clip that can't load within 3.5 seconds.
- Clips are stored next to the database (on the Railway volume) under `media/`, up to 20 MB each, and served from `/media/`
  with streaming and long caching. The app starts downloading the winning clip while the wheel is still spinning.
- New routes: `GET /admin/wheel`, `PUT /admin/wheel/:animal/video` (body is the video file), `DELETE /admin/wheel/:animal/video`.

## 1.3.0

- **Animal prize wheel.** Each segment has an animal: goat 20, wolf 50, crocodile 100, bull 50, lion 200, eagle 100,
  and the dragon for the 500 jackpot (it glows on the wheel). Segments and animals are set together in `SPIN_SEGMENTS`
  in `src/rules.js`.
- **Win show** (`public/beast.js`): the winning animal appears, rears back and breathes fire and smoke while the screen
  shakes (and the phone vibrates where supported), then the coins burst out and the prize counts up. The stronger the animal,
  the bigger the fire, shake and coin burst; the dragon jackpot is the biggest, with a full-screen flash.
  Tap to skip. People who turn on "reduce motion" on their phone get a calm version without fire or shaking.

## 1.2.0

### New
- **The whole user app is translated** into English, French, Spanish, Chinese, Swahili, Hausa and Twi: every screen, dialog,
  button, error and notification. Switching language changes everything at once and is saved on the account.
- **Language from the visitor's country.** On a first visit the app works out the country from the device's time zone
  (for example Africa/Lome means Togo) and opens in that country's official language. No location permission or outside
  service is used. Countries whose language isn't supported get English.
- **Country at sign-up.** The sign-up form has a country list (pre-filled with the detected country). Picking a country switches
  the app to its language. The country is saved on the account, can be changed in the Me tab, and shows in the admin dashboard
  and the users CSV.
- Translations live in `backend/i18n/*.json`. After editing them, run `npm run i18n` to rebuild `public/i18n.js`.
  The build and the tests fail if a language misses a text or changes a {placeholder}.

### Changed
- **Spin wheel prizes are 10x:** 20, 50, 100, 50, 200, 100, 500 WTC.
- **The wheel unlocks only after all of today's tasks are finished** (completed, or missed with a wrong answer).
  It shows how many are left, e.g. "3 of 5 done".
- The wheel pointer is drawn instead of using a text character, so it looks the same on every phone.

## 1.1.0

### New
- **Paystack payments.** Premium plans can be paid with Mobile Money or card. The plan switches on by itself once Paystack
  confirms the exact amount (signed webhook, plus a check when the user returns). Wrong amounts wait for an admin.
  Manual payments still work. New: `POST /premium/checkout`, `GET /premium/checkout/:reference`, `POST /webhooks/paystack`,
  `GET /admin/payments`, `POST /admin/payments/:id/recheck`, `POST /admin/payments/:id/approve`, `fxRate` in settings.
- **Moving up a plan keeps unused days**, converted at the price difference.
- **Two-step login** with authenticator apps, 10 one-time backup codes, replay protection, and a 15-minute lock after 5 wrong
  codes. Secrets are encrypted in the database. Required for staff in production (`ADMIN_REQUIRE_2FA`).
- **Staff roles:** support, admin and owner, each limited to its own admin routes. The owner manages roles
  (`POST /admin/users/:id/role`), can reset a lost phone (`POST /admin/users/:id/reset-2fa`), and sees `GET /admin/staff`.
- **Sign out everywhere** for yourself (`POST /me/logout-all`) or for another user (`POST /admin/users/:id/logout`).
- Staff logins expire after 12 hours (`STAFF_SESSION_HOURS`), and staff sign-ins are written to the audit log.
- `npm run make-owner -- email` to set the owner from the server's shell.

### Fixed
- **Anyone could become admin** by signing up first with the admin email. The owner now needs `ADMIN_SETUP_CODE`, which only
  works while there is no owner.
- **Old logins stayed valid** after a password change, password reset or ban. All of these now sign out every old login.
  `POST /me/password` returns a new token for the current device.
- **The 5-tasks-per-hour limit could be bypassed** by starting many tasks at once. It is now also checked when a task is
  finished, along with plan access and the task budget.
- Two signups with the same email at the same moment returned an error 500 instead of 409.

### Changed
- The `admin` role from 1.0 becomes `owner` on first start. Existing logins keep working.
- `ADMIN_EMAIL` alone no longer grants admin in production. In development it still does when `ADMIN_SETUP_CODE` is empty.
- Staff accounts can't be banned or deleted until the owner removes their role. Staff passwords need 10+ characters.
- New dependency: `qrcode` (for the two-step login QR code).
