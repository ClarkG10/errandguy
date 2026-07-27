# ErrandGuy Admin Panel (Filament v4)

A complete web admin at **`/admin`**, built on Filament v4, served by the same
Laravel app. It authenticates against the existing `admin` session guard
(`config/auth.php` → `admins` provider → `App\Models\AdminUser`) — separate from
the mobile app's Sanctum tokens.

## What it covers

Grouped in the sidebar:

- **Operations** — Bookings (view + admin cancel), Errand Types (pricing CRUD),
  Reviews (moderation / flag).
- **People** — Users (suspend/unsuspend), Runner Profiles (approve/reject +
  documents), Trusted Contacts.
- **Money** *(finance/super_admin)* — Payments (refund), Payouts (complete/fail),
  Wallet Transactions (ledger), Promo Codes (CRUD), Referrals (reward), linked
  Payment Methods (read-only).
- **Safety & Support** — SOS Alerts (resolve, with a live red badge), Disputes
  (resolve/escalate), Support Tickets (threaded reply).
- **System** *(super_admin)* — System Config, Platform Payment Methods,
  Push Broadcast, Notification log.
- **Dashboard** — stats (customers/runners, active bookings, GMV today, pending
  verifications, open disputes, **active SOS**) + latest bookings.

## Money/state safety

Sensitive actions route through the **same services** the API uses — never raw
model writes:

- Payment refund → `PaymentService::refundPayment()` (goes through
  `Payment::transitionTo`; the action is only visible when `status === completed`).
- Booking cancel → `BookingService::adminCancel()` (full wallet refund, no fee).
- Payout complete/fail → `WalletService::completePayout()/failPayout()` (fail
  re-credits the wallet atomically).
- SOS resolve → `SOSService::deactivateSOS()`.

Every sensitive action is recorded to the `admin` activity log
(`spatie/laravel-activitylog`) via `App\Support\AdminActivity`.

## Roles (RBAC)

`admin_users.role` — one of `super_admin`, `admin`, `finance`, `support`, `ops`.
Navigation and actions auto-hide by role:

- **super_admin** — everything, incl. System.
- **finance** — Money group + everything non-restricted.
- **support** / **ops** — Safety & Support, People, Operations.
- **admin** — People, Operations, Promo Codes, Push Broadcast.

## First-time setup / deploy (Forge)

> The `.env` here points at the **production Supabase DB**. Run DB-writing
> commands (`migrate`, `errandguy:make-admin`) deliberately, on the box you
> intend to affect.

```bash
# 1. Install PHP deps (Filament + activitylog are in composer.json)
composer install --no-dev --optimize-autoloader

# 2. Run migrations (adds the activity_log table)
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

Then sign in at `https://<api-host>/admin`.

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
(never `$model->update([...])` on payments/payouts/bookings).
