# Changelog

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
