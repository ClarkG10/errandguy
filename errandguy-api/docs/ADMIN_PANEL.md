# ErrandGuy Admin Panel (Filament v4)

A complete web admin at **`/admin`**, built on Filament v4, served by the same
Laravel app. It authenticates against the existing `admin` session guard
(`config/auth.php` → `admins` provider → `App\Models\AdminUser`) — separate from
the mobile app's Sanctum tokens.

## What it covers

Grouped in the sidebar (who can open each page is in **Roles** below):

- **Operations** — Bookings (view; cancel, re-run matching, return to matching
  and mark completed from the list or the errand page, which also has
  tap-to-call phones and links to both people and the payment), Errand Types
  (edit prices, copy and the on/off switch; no adding or deleting types, the
  slug is fixed, every edit is in the audit log), Reviews (moderation / flag). Promo codes are retired, so a
  booking only shows a "Past promo code discount" line when it was made with
  one before then.
- **People** — Users (suspend/unsuspend), Runner Profiles (approve/reject +
  documents), Trusted Contacts, Saved Addresses.
- **Money** — Payments (refund), Payouts (runner payouts, customer withdrawals
  and payouts queued by account deletion: "Send via Xendit", "Check with
  Xendit" for a sent payout, manual complete/fail for an unsent one, and "Pay a
  runner"; sending to an account other than the one on record needs a reason
  and alerts money staff; a payout marked completed by hand needs how it was
  paid and the reference; CSV export), Wallet Transactions (ledger, with a
  "By staff" column and filter for money moved by hand).
- **Safety & Support** — SOS Alerts (resolve, with a live red badge; every
  admin page of safety staff beeps and shows a browser notification on a new
  SOS), Support Tickets (threaded reply; "Reports about a person" filter).
- **System** — Staff, System configs (settings), Platform Payment Methods,
  Push Broadcast, Notification log, Audit log.
- **Dashboard** — live alerts, "Needs attention" queues (active SOS, stuck
  errands, verifications, support waiting on us, pending payouts), today's
  stats, charts, top runners, latest bookings.
- **My account** — every staff member's own name, email, password and
  two-step sign-in.
- **SOS staff alerts** — set `ops_alert_emails` and `ops_alert_phone` under
  System configs; texts need `SEMAPHORE_API_KEY` in the server env.

## Roles (RBAC)

`admin_users.role` — one of `super_admin`, `admin`, `finance`, `support`,
`ops`. Navigation and actions hide by role, and a hidden page or action can't
be opened by URL either.

| | super_admin | admin | finance | support | ops |
|---|:-:|:-:|:-:|:-:|:-:|
| Dashboard, Bookings, Users, Runner Profiles, Reviews, Errand Types (view), Trusted Contacts, Saved Addresses, Notification log | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cancel / re-run errands, suspend users, approve runners & KYC documents | ✓ | ✓ | | | ✓ |
| Support Tickets, SOS Alerts (+ SOS alarm) | ✓ | ✓ | | ✓ | ✓ |
| Errand Types (edit), delete/unflag reviews, Push Broadcast, Audit log | ✓ | ✓ | | | |
| Payments, Payouts, Wallet Transactions, Platform Payment Methods, wallet adjustments | ✓ | | ✓ | | |
| GMV, platform revenue and runner earnings (dashboard, errand list, top runners, runner profiles) | ✓ | | ✓ | | |
| CSV exports with phone numbers, emails or wallet data (Users, Runners, Wallet ledger) | ✓ | ✓ | | | |
| Staff, System configs | ✓ | | | | |

Other CSV exports (bookings, payments, tickets, SOS, reviews, notifications)
are open to whoever can open that list. Dashboard cards and alerts link only
to pages the viewer can open: the "Pending payouts" card is for money roles,
the SOS and support cards stay visible to everyone but aren't links for
finance, and alerts about staff moving money by hand are shown to money roles
only.

## Staff sign-in

- **Two-step sign-in is required for every role** (Filament multi-factor
  authentication): an authenticator app (with recovery codes) or a code
  emailed to the staff member. Staff who haven't set one up are sent to set it
  up right after their password, before any page. Manage it on My account. A
  super admin can reset a lost one on the Staff page.
- **Lockout**: 5 failed sign-ins on one email lock it for 15 minutes, on top
  of the per-IP limit (5 tries a minute, by the real client IP from
  `TRUSTED_PROXIES`). A super admin can lift it early ("Unlock sign-in").
- **Keep me signed in** lasts 14 days (`config/auth.php` → `admin.remember`).
- **Audit**: every sign-in (`auth.signed_in`), failed attempt
  (`auth.sign_in_failed`, with the reason), lock (`auth.sign_in_locked`) and
  password set from an emailed link (`auth.password_reset`) goes to the audit
  log with the IP.
- **Disabled staff** can't sign in, and an open session ends on their next
  click (`AuthenticateStaff`); their "keep me signed in" cookie stops working.
- The staff files served outside the panel (KYC documents, booking media, the
  SOS alarm feed) refuse a disabled session or one without two-step sign-in
  (`RestrictStaffSessions`).
- Sign-in codes and set-password emails are sent straight away, not queued.

## Staff page (super admin)

System → Staff, through `StaffAccountService`, every change audited:

- **Add staff member** — name, email (unique among staff), role. They get an
  email with a link to choose their password (the staff-only `admins` password
  broker, links last 60 minutes) and set up two-step sign-in at first sign-in.
  Nobody ever sees or types a temporary password.
- **Change role**, **Disable / Enable account** (disable asks for a reason),
  **Send set-password email**, **Reset two-step sign-in**, **Unlock sign-in**.
- You can't change your own role or disable yourself, and the panel always
  keeps at least one active super admin.
- "Forgot password?" on the sign-in page sends the same kind of link.
- `errandguy:make-admin` still creates or resets an account from the server;
  add `--reset-two-step` for a super admin who lost both their phone and their
  recovery codes (it also lifts a sign-in lock). `--unlock` on its own (no
  `--password`) only lifts the lock after too many failed sign-ins. An existing
  account keeps its name and role unless `--name` / `--role` are given.

## My account

Changing your name, email or password asks for your current password first; a
new email can't be one another staff account uses. A password change keeps
this browser signed in and signs out every other session.

## Settings (System configs)

Only settings the code reads are listed (`App\Support\SystemSettings`), each
with a plain description and a check its value must pass before it saves —
number ranges (the platform fee is 1–50 %, never 0), whole numbers, on/off,
email and phone lists. Settings nothing reads can't be edited, and new keys
can't be added. Every change is written to the audit log (`setting.changed`,
old → new, who) and applies at once. `enabled_payment_methods` is changed on
Platform Payment Methods. The data migration
`2026_10_31_000015_add_missing_settings` creates any missing setting with the
value the code already falls back to and never overwrites a value.

## Money/state safety

Sensitive actions route through the **same services** the API uses — never raw
model writes:

- Payment refund → `PaymentService::refundPayment()` (goes through
  `Payment::transitionTo`; the action is only visible when `status === completed`).
- Booking cancel → `BookingService::adminCancel()` (full wallet refund, no fee).
- Payout complete/fail → `WalletService::completePayout()/failPayout()` (fail
  re-credits the wallet atomically). A payout already sent to Xendit can only
  be failed on Xendit's word (`WalletService::refreshSentPayout()`, the payout
  webhook); a "paid" notice for a payout already failed raises a critical
  `payout_paid_after_failed` alert.
- Wallet adjustment → `WalletService::adjust()`; "Pay a runner" →
  `WalletService::payout()`. Both record which staff member did it
  (`wallet_transactions.initiated_by_staff_id`) and are limited by
  `StaffMoneyLimit`: each staff member can move at most
  `admin_adjustment_daily_cap` (₱20,000 to start) per Manila day — credits,
  debits and payouts added together — and any single one of
  `admin_adjustment_alert_threshold` (₱5,000) or more raises a dashboard alert
  for money staff. A single adjustment is also capped at ₱10,000.
- SOS resolve → `SOSService::deactivateSOS()`.

Every sensitive action is recorded to the `admin` activity log
(`spatie/laravel-activitylog`) via `App\Support\AdminActivity`.

## Days and alerts

"Today" figures and daily chart bars count Manila calendar days
(`App\Support\BusinessDay`), as do the list date filters; the database stays
in UTC. A background task that failed for good shows as a red "Error" alert.

## First-time setup / deploy (Forge)

> The `.env` here points at the **production DB**. Run DB-writing commands
> (`migrate`, `errandguy:make-admin`) deliberately, on the box you intend to
> affect.

```bash
# 1. Install PHP deps (Filament + activitylog are in composer.json)
composer install --no-dev --optimize-autoloader

# 2. Run migrations (staff two-step columns, staff password links, settings)
php artisan migrate --force

# 3. Publish + cache Filament assets and optimize
php artisan filament:assets
php artisan filament:optimize
php artisan config:cache && php artisan route:cache

# 4. Create the first admin (interactive prompts for password)
php artisan errandguy:make-admin
#   or non-interactively:
php artisan errandguy:make-admin you@errandguy.app --name="You" --role=super_admin --password='********'
```

Then sign in at `https://<api-host>/admin`. On first sign-in every staff
member sets up two-step sign-in (an authenticator app is recommended — keep
the recovery codes; emailed codes need working mail). After that, add other
staff from System → Staff rather than with `make-admin`.

### Notes
- Sessions: the panel uses the web session guard. Prod uses the Redis session
  driver (fine); ensure `SESSION_DOMAIN`/`APP_URL` match the admin host.
- `make:filament-user` is **not** usable (AdminUser uses `full_name` /
  `password_hash`) — always use `errandguy:make-admin`.
- After deploying new resources/pages, re-run `php artisan filament:optimize`
  (or `filament:optimize-clear` in dev).
- Not auto-deployed: this panel lands with the rest of the branch; deploy on
  your normal cadence.

## Adding a resource later

```bash
php artisan make:filament-resource ModelName        # scaffolds under app/Filament/Resources/
```
Set `$navigationGroup`, gate with `canViewAny()`/`canCreate()` using the
`AdminUser` role helpers, and route any money/state mutation through a service
(never `$model->update([...])` on payments/payouts/bookings). Spell out every
`can*()` (incl. `canDeleteAny()`): the AdminUser `Gate::before` allows
everything, so a missing one opens it to every role. A new setting the code
reads goes in `SystemSettings` plus a data migration that creates its row.

## Times

Every time in the panel, the booking timeline and CSV exports is Manila time
(`FilamentTimezone`, set in `AdminPanelProvider`). Exported time columns say
"(Manila time)" in their header. Timestamps are still stored in UTC.
