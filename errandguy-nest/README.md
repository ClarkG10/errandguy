# ErrandGuy API — NestJS

A faithful NestJS re-implementation of the Laravel 13 ErrandGuy backend. It talks to the
**same Supabase Postgres database** and serves the **same `/api/v1` contract**, so the existing
mobile app and all logged-in users keep working with zero changes.

## Migration guarantees

- **Same database.** Prisma models are hand-mapped to the exact existing tables/columns
  (`prisma/schema.prisma`). No destructive migration is ever run against the shared DB. The only
  additive object is the queue table in `prisma/sql/000_queued_jobs.sql` (apply once, by hand).
- **Same API contract.** Global prefix `/api/v1`, identical routes, request validation, response
  JSON shapes (including Laravel quirks: money fields serialized as **strings** `"0.00"`,
  `UserResource` self-only field omission, pagination envelope, error bodies).
- **Same auth.** Laravel Sanctum-compatible bearer tokens — `{tokenId}|{random}`, `sha256(random)`
  stored in `personal_access_tokens`, polymorphic `tokenable_type` = `App\Models\User` /
  `App\Models\AdminUser`. **Existing tokens keep authenticating**; no forced re-login.
- **Same realtime.** Writes to `notifications` / `messages` / `runner_locations` still drive the
  app's Supabase realtime subscriptions (via `RealtimeService` PostgREST writes).

## Stack

| Concern | Laravel | NestJS port |
|---|---|---|
| Framework | Laravel 13 | NestJS 10 (Express) |
| ORM | Eloquent | Prisma 5 (introspection-compatible schema) |
| Auth | Sanctum | custom Sanctum-compatible `SanctumService` + guards |
| Passwords | bcrypt | `bcryptjs` (`$2y$`→`$2b$` normalised) |
| Validation | FormRequest | class-validator DTOs → Laravel-shaped 422 |
| Queue | database driver | DB-backed `queued_jobs` + polling worker (`@nestjs/schedule`) |
| Events | `Event::listen` | `@nestjs/event-emitter` |
| Rate limit | RateLimiter | `@nestjs/throttler` (credential/token/ip trackers) |
| Push | kreait/firebase | `firebase-admin` + Expo HTTP |
| Payments | Xendit HTTP | `XenditService` (axios) |
| Email | resend-laravel | `MailService` (Resend HTTP) |
| Storage | Supabase REST | `SupabaseStorageService` (axios) |
| PDF | dompdf | `pdfkit` (planned; see below) |

## Setup

```bash
cd errandguy-nest
cp .env.example .env         # fill DATABASE_URL / DIRECT_URL / integration keys
npm install
npx prisma generate          # generate the typed client (no DB needed)

# ONE-TIME: create the additive queue table on the shared DB
psql "$DIRECT_URL" -f prisma/sql/000_queued_jobs.sql

npm run start:dev            # http://localhost:3000/api/v1
```

`DATABASE_URL` should point at the pooled Supabase connection (port 6543, `pgbouncer=true`);
`DIRECT_URL` at the direct connection (5432) for `prisma db pull` and the queue-table SQL.

## Project layout

```
src/
  main.ts                    # bootstrap: prefix, body caps, CORS, global pipe/filter/interceptors
  app.module.ts              # module wiring + global middleware + throttler guard
  config/                    # typed env config
  prisma/                    # PrismaService (@Global)
  common/
    auth/                    # SanctumService, HashService, guards (auth/active/roles/admin), decorators
    middleware/              # security-headers, sanitize-input, limit-request-shape
    interceptors/            # log-requests, cache-control
    idempotency/             # @Idempotent + durable interceptor
    throttling/              # throttler config + @AuthThrottle/@OtpThrottle/@RouteThrottle
    exceptions/              # Laravel-shaped validation exception + global filter
    resources/               # UserResource / RunnerProfileResource / RunnerDocumentResource
    serialization.ts         # dec()/iso() — Laravel cast parity
    pagination.ts            # Laravel paginator envelope
  cache/                     # SWR CacheService (@Global)
  messaging/                 # NotificationService, RealtimeService, PushService (@Global)
  integrations/              # SupabaseStorageService, XenditService, MailService (@Global)
  queue/                     # QueueService + QueueWorkerService (@Global)
  modules/                   # one folder per feature area
```

## Status — COMPLETE (all 17 modules)

Verified: `npm run build` clean · DI container boots (all providers resolve) · **125 mapped routes
== 125 Laravel `routes/api.php` routes** (exact parity, every method).

| Module | Coverage |
|---|---|
| **auth** | register, login, logout, send-otp, verify-otp, social-login, forgot/reset-password |
| **user** | profile show/update, avatar, fcm-token, delete-account; addresses CRUD; trusted-contacts CRUD |
| **catalog** | `GET /errand-types` (SWR raw shape), `GET /config/app` |
| **referral** | show, apply (+ generateCode/attach/reward/creditBonus, wallet bonus credit) |
| **notification** | list, unread-count, read, read-all, archive/unarchive, delete, clear-all |
| **chat** | unread-count, conversations, messages (paging), send (+image), mark-read |
| **promo** | list, validate (+ validate/redeem/discount) |
| **review** | customer + runner review (rating recompute) |
| **wallet** | balance, top-up (idempotent Xendit invoice), transactions, status; deduct/refund/payout |
| **payment** | methods (list/link/store/default/delete), history, receipt, status + for-booking probes; `PaymentService` (charge/invoice/link/refund); **payment-status state machine + audit** (`transitionPayment`); **`XenditWebhookController`** (replay-guard + row-locked settlement) |
| **booking** | create (pricing/promo/4 payment paths/conditional validation), estimate, list, active, show, track, cancel(+preview), rebook, retry-match; `MatchingService`/`LocationService`; events→listeners; `@Cron` sweeps (auto-cancel, expire-negotiate, ride-duration, cleanup) + match/broadcast queue handlers |
| **runner** | profile, documents (Supabase), online, location, errand current/available/show/accept/decline/status/verify-pin, earnings(+history/export), payout (idempotent), heatmap/peak-hours; bank number encrypted at rest |
| **safety** | customer + runner SOS trigger/deactivate, trip-share share/revoke, public `GET /trip/{token}` |
| **shopping** | customer shopping-items update, runner shopping-checklist toggle |
| **support** | tickets list/create/show, post-message; legacy `POST /support/report` |
| **admin** | login/logout/me (admin token), dashboard stats, users, runner verification, bookings mgmt, disputes, payouts (complete/fail + refund), payment-method settings |
| **export** | receipt PDF, earnings-statement PDF (`pdfkit`) |
| **webhooks/public-trip** | `POST /webhooks/xendit`, `GET /trip/{token}` (folded into payment/safety) |

Verify locally:
```bash
npm run build           # tsc/nest build
npm run start:dev       # boots against your Supabase DB
```

## Parity notes (intentional, documented deviations)

- **Avatar & chat uploads** now go to Supabase Storage (`avatars` / `chat-images` buckets) instead
  of Laravel's local `public` disk — the Node app has no local public-disk equivalent, and Supabase
  gives a real public URL. Response shape is unchanged.
- **Rate limiting**: per-credential auth (5/15m), OTP (3/h) and per-route caps are preserved; the
  guest-only 20/min global cap and the secondary 30/15m-per-IP auth cap are not separately modelled.
- **Dates** serialize as ISO-8601 `...Z` (JS `toISOString`) vs Laravel's `+00:00` offset — same
  instant, minor textual difference.
- **`last_active_at`** presence write is throttled in-process (per instance) to 1/60s/user, via a
  raw UPDATE that does not bump `updated_at` (matches Laravel).
- **Admin schema-mismatch fixes (correctness).** Several Laravel admin actions referenced columns
  that don't exist in the migrations and would 500 at runtime; the port targets the *real* schema:
  user suspend/unsuspend uses `users.status` = `suspended`/`active` (there is no `is_active` /
  `suspended_reason`); runner approve sets `runner_profiles.approved_at` (not `verified_at`);
  runner reject writes the reason onto the pending `runner_documents` (there is no
  `runner_profiles.rejection_reason`); runner documents are looked up by `runner_id` (→
  `runner_profiles.id`); dispute resolve writes `dispute_tickets.resolution` (Laravel used a
  non-existent `resolution_note`); admin booking-cancel sets `cancelled_by = NULL` and records
  "Cancelled by admin" in the status log (an admin is not a `users` row, so the old
  `cancelled_by = 'admin'` string could never satisfy the uuid FK).
- **Admin list endpoints** return Laravel's flat `LengthAwarePaginator` JSON
  (`current_page`/`data`/`total`/…), matching `response()->json($paginator)`; the customer-facing
  lists use the API-resource `{data, links, meta}` envelope, as in Laravel.
- **Runner `bank_account_number`** is encrypted at rest with AES-256-CBC keyed by
  `APP_ENCRYPTION_KEY` and never serialized, but the payload format is **not** byte-compatible with
  Laravel's `Crypt` (which adds an HMAC and a JSON envelope). If real bank numbers were written by
  the old Laravel app, port that field with a Laravel-compatible decrypter before cutover (this is
  a single write-mostly field; empty pre-launch DBs are unaffected).
- **Background work** uses `@Cron` reconciliation sweeps over domain state (auto-cancel,
  expire-negotiate, ride-duration) instead of Laravel's delayed queue jobs — equivalent outcomes,
  and robust across restarts. Immediate match/broadcast run inline (or via the `queued_jobs` worker
  for scheduled bookings), mirroring Laravel's `dispatchSync`.

## Deploy

Two supported paths — the app is a standard Node HTTP server (`node dist/main.js`), so anything
that runs Node works.

### Laravel Forge (Node via PM2 cluster + Nginx proxy)

Forge provisions Node on its Ubuntu servers, so a NestJS app runs fine — it just isn't the PHP-FPM
"happy path". Run it under **PM2** (zero-downtime reloads + cluster mode for all CPU cores) behind
the site's Nginx. The repo is a monorepo, so the app lives in the `errandguy-nest/` subdirectory.

**One-time server prep** (SSH as `forge`):
```bash
node -v                      # ensure v18+ (v20 recommended); use nvm if older
npm install -g pm2
pm2 startup systemd          # run the sudo line it prints, so PM2 survives reboots
```

**1. Create Site** (Forge → *Sites → New Site*)
| Field | Value |
|---|---|
| Root Domain | `api.errandguy.app` (a subdomain — can share the box with the Laravel site) |
| Project Type | `General PHP / Laravel` (you'll override Nginx; PHP never runs) |
| Web Directory | `/errandguy-nest/dist` (cosmetic — Nginx proxies to Node) |
| Create Database | **unchecked** (you use Supabase) |

**2. Git Repository** (Site → *App → Git Repository*)
- Repository `your-org/errandguy`, Branch `main`
- **Uncheck "Install Composer Dependencies"** (no PHP)
- Forge clones the whole repo to `/home/forge/api.errandguy.app`

**3. Environment** (Site → *Environment*) — paste your real `.env` (keys listed in `.env.example`):
`DATABASE_URL`, `DIRECT_URL`, `APP_URL=https://api.errandguy.app`, `PORT=3000`, `API_PREFIX=api/v1`,
`SANCTUM_EXPIRATION`, `TOKENABLE_USER_TYPE`, `TOKENABLE_ADMIN_TYPE`, `BCRYPT_ROUNDS=12`,
`APP_ENCRYPTION_KEY` (`openssl rand -base64 32`), `CORS_ALLOWED_ORIGINS`, `XENDIT_*`, `SUPABASE_*`,
`FIREBASE_*`, `RESEND_API_KEY`, `MAPBOX_SECRET_TOKEN`. Forge writes this to the **site root**.

**4. Deploy Script** (Site → *App → Deploy Script*)
```bash
cd /home/forge/api.errandguy.app
git pull origin $FORGE_SITE_BRANCH

cd errandguy-nest
ln -sf ../.env .env                 # expose Forge-managed env to the app (loaded from cwd)
npm ci
npx prisma generate
npm run build

pm2 startOrReload ecosystem.config.js --update-env
pm2 save
```

**5. One-time DB step** (creates the additive queue table — nothing else is migrated):
```bash
psql "$DIRECT_URL" -f /home/forge/api.errandguy.app/errandguy-nest/prisma/sql/000_queued_jobs.sql
```

**6. Nginx** (Site → *Edit Files → Edit Nginx Configuration*) — replace the `location /` block; keep
everything Forge generated (the `server {}` wrappers, SSL, logs):
```nginx
location / {
    proxy_pass http://127.0.0.1:3000;     # the PM2 cluster (errandguy-api)
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}
```

**7. SSL** (Site → *SSL → Let's Encrypt*) — issue for the domain.

**8. Process model** — `ecosystem.config.js` (in the repo) runs two roles from one build:
`errandguy-api` (cluster, one worker per core, HTTP only) and `errandguy-worker` (single process
that owns the `@Cron` sweeps + drains the DB queue, on internal port 3001). **Do NOT** enable the
Forge *Scheduler* or *Queue Workers* — those are Laravel-only; the Node worker handles both.
Only port 80/443 is public; 3000/3001 stay internal (firewall them off).

> Because Forge is PHP-first, a Node-native host (Render / Railway / Fly.io) or the Docker image
> below is lower-friction. Forge works well if you want one control panel + the same server/region
> as your existing Laravel app (which also means the lowest-latency hop to the same Supabase DB).

### Docker (portable)

Multi-stage `Dockerfile`: `npm ci && npm run build` → runtime image running `node dist/main.js`
with `npx prisma generate` at build. Deploy to any container host; set env vars there.

## Testing

Port `../errandguy-api/tests/Feature/**` to `test/**` e2e specs (supertest) against a disposable
Postgres. The Sanctum token contract and Laravel error/response shapes are the key parity assertions.
