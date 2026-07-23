# ErrandGuy — Comprehensive System Audit (2026-07)

> Method: the codebase was read directly (not the docs). 15 specialized senior-role
> auditors (architect, PM, backend, frontend, DevOps, QA, security, product owner)
> analyzed the three codebases; every critical/high finding was then re-checked by an
> independent adversarial verifier. 55 agents total; 2 findings refuted on verification,
> 10 severity-adjusted. What remains is **5 critical, 25 high, 56 medium, 8 low**.

---

## 1. What the system actually is (from the code)

**ErrandGuy is a two-sided, on-demand errand/courier marketplace for the Philippines.**
Customers post errands (delivery, shopping, bills, queueing, and "transportation"/ride
tasks); nearby verified runners are matched to them, fulfil them through a live-tracked
status flow, and are paid out through an in-app wallet. Money moves through Xendit
(GCash / Maya / GrabPay / cards / hosted invoices), a cash option, and a wallet balance
that runners can withdraw.

### Three codebases

| Codebase | Stack | Role | Reality |
|---|---|---|---|
| `errandguy-api` | Laravel 13 / PHP 8.3, Sanctum, Eloquent, Supabase Postgres, Redis-ish (actually **file** cache), Firebase, Resend, Xendit | **The live production backend** (mobile talks to it via `EXPO_PUBLIC_API_URL`, a Forge host) | 26 models, 45 migrations, ~47 controllers, **125 routes**, 35 test files (SQLite-only) |
| `errandguy-nest` | NestJS 10 + Prisma 5 on the **same** Supabase DB, same `/api/v1` contract | An in-progress re-implementation intended to replace Laravel | Claims 125-route parity — but **0 tests, untracked by git, already behaviorally diverged** |
| `errandguy-mobile` | React Native / Expo Router, Zustand, custom SWR/dedup fetch layer | The client both sides use | 71 route screens, 18 test files (state/UI only — no network/money tests) |

### The core flows, as implemented

- **Booking create** (`BookingController::store`): server-authoritative pricing
  (`PricingService`), then payment is collected *at create time* — wallet is debited (booking
  deleted on insufficient funds), cash is left unpaid, online creates a Xendit invoice/charge.
  Booking starts `pending`.
- **Matching**: *fixed* price → `MatchRunnerJob` assigns the single nearest eligible runner
  (`matched`); *negotiate* → `BroadcastToRunnersJob` notifies nearby runners. Eligible =
  online + approved + pinged in the last 5 min + inside a bounding-box radius + not already
  on an active errand.
- **Accept** (`/runner/errand/{id}/accept`): correctly `lockForUpdate`-guarded so two runners
  can't claim the same job.
- **Fulfil**: runner advances a per-errand-type status flow; on `completed`,
  `handleCompletion` credits `runner_payout` to the runner's withdrawable wallet.
- **Cancel**: tiered fee (free pre-accept, ₱20 en route, 50% once arrived/picked up); remainder
  refunded to the customer **wallet**.
- **Settlement**: the Xendit webhook (`XenditWebhookController`) is the one genuinely
  well-built money component — timing-safe token check, replay guard (`webhook_events`),
  row locks, and a payment state machine.

---

## 2. Apparent vision vs. actual implementation

The vision — a trustworthy, safety-first, cashless-capable gig marketplace — is **largely
built at the surface and undermined underneath by three systemic gaps**:

1. **"Safety-first" is mostly theatre.** SOS tells the user *"Emergency contacts have been
   notified"* but **no contact is ever contacted** — the SMS function only writes a log line.
   The ride-duration and route-deviation monitors **never run** (unscheduled + a latent
   TypeError + never dispatched). Masked calling is a TODO, so customers and runners exchange
   real mobile numbers on every job. These are the features that justify a stranger-meets-
   stranger marketplace, and they are inert.

2. **The money layer is correct on the happy path but soft under concurrency and un-collected
   money.** Pricing is server-authoritative (good) and the webhook is solid (good), but the
   wallet has **no database-level idempotency**, several **check-then-act races** can
   double-credit, and completion **pays runners for cash/unsettled jobs the platform never
   collected** — the single largest money hole.

3. **Two backends, one production database, no shared source of truth.** The NestJS port
   hand-re-implements every money rule (pricing, payout, wallet, the payment state machine)
   and has **already drifted** (Nest uses `Decimal`; Laravel uses `float`; failure paths
   differ). It is untracked in git and has zero tests, yet is packaged for PM2 production.
   Running both against the same DB is a latent money-divergence and data-corruption event.

---

## 3. Findings by severity (verified)

### 🔴 CRITICAL (5 → 3 distinct issues after dedup)

| # | Issue | Where | Impact |
|---|---|---|---|
| C1 | **Social login accepts any Google/Facebook token — audience/app never verified** | `SocialLoginController` (Laravel) + `auth.service.ts` (Nest) | **Full account takeover.** Google's `tokeninfo` proves a token is genuine but never checks `aud`/`email_verified`; Facebook `/me` accepts any app's token. Login keys on email alone → take over *any* account (wallet, saved cards, payout data) with a token minted by the attacker's own OAuth app. |
| C2 | **Completion credits the runner's withdrawable wallet for cash & never-settled bookings** | `RunnerErrandController::handleCompletion:543-580` (+ Nest) | **Unbounded, recurring money loss.** Cash bookings are `unpaid`; the runner physically collects the fare, then the platform *also* credits `runner_payout` to their withdrawable balance — money the platform never received, and never collects its service fee. Scales with cash volume (the default method). |
| C3 | **SOS "emergency contacts notified" is false** | `SOSService::notifySMSContact` + `SendSafetyAlertNotification` (both backends) | **Life-safety false assurance + liability.** The UI says contacts were notified; the code only logs. Zero contacts receive anything. |

*(C1 and the security-lens duplicate `social-login-audience-confusion` are the same issue;
C2 is reported by both booking-lifecycle and payment-money-safety lenses.)*

### 🟠 HIGH (25 — grouped)

**Money-safety (Laravel prod):**
- **H1 Double-completion race → double runner credit.** `handleCompletion`'s `exists()`
  earning-guard runs *before* the row lock (TOCTOU); the booking is never locked. Two
  concurrent/retried completes both credit. *No unique constraint backs it.*
- **H2 Cancel refund is non-atomic & non-idempotent.** `cancel()` has no transaction/lock;
  concurrent double-tap → double wallet refund. Also "refunds" card payments as wallet credit
  while marking the `Payment` gateway-`Refunded` (no real reversal) → reconciliation breaks.
- **H3 `handleCompletion` marks `Payment` paid with a raw `->update()`**, bypassing the
  documented `transitionTo()` funnel + audit log, and can launder `failed/expired → completed`
  with a fabricated `paid_at`.
- **H10 Settlement webhooks don't verify the confirmed amount**; Nest webhook token compare
  is not constant-time.

**Auth / security:**
- **H4 Admin "suspend user" is a silent no-op** — writes non-existent columns (`is_active`,
  `suspended_reason`); suspended/banned users keep full access; the admin filter 500s.
- **H5 Phone-OTP SMS is an unimplemented stub that logs the plaintext OTP**; verify mints a
  real session → anyone with log access takes over any phone account. Primary PH onboarding
  channel is silently broken.
- **H6 Runner KYC docs + delivery proofs on world-readable public disk** — permanent,
  unrevocable, unauthenticated URLs to gov-ID/selfie/license (Data Privacy Act exposure).
- **H7 OTP codes, SOS live-link tokens, and phone numbers written to logs.**
- **H8 Password-reset token expiry check is dead under Carbon 3** → tokens valid forever.
- **H9 Runner `decline` has no assignment check** — any runner can reset another runner's
  matched booking back to `pending`.

**Business logic / UX:**
- **H11 Negotiate mode ignores `customer_offer` entirely** — price & payout are always the
  fixed values; the customer is charged the wrong amount up front. The feature is a no-op.
- **H12 A booking `matched` to an unresponsive runner is stranded forever** — no acceptance
  timeout/requeue, and the fixed-mode runner is never even notified (learns only by polling).
- **H13 Scheduled bookings are dropped into an immediate "searching…" countdown** that times
  out to "No runners available" — the scheduling feature is broken from the user's view, with
  a possible double-charge on the terminal "rebook" button.
- **H14 Real phone numbers exposed between customer & runner** (masked-call is a TODO).

**Safety:**
- **H15 Ride-duration & route-deviation monitors are entirely non-functional** (unscheduled +
  TypeError + never dispatched).

**Performance / scale:**
- **H16 Booking-create blocks on a sequential per-runner Supabase HTTP fan-out** (negotiate),
  after already making a synchronous gateway call — latency scales with N runners; a slow
  Supabase can hang create for up to N×timeout.

**Architecture / DevOps / QA:**
- **H17 Money logic hand-duplicated across two backends, no shared source of truth**, already
  drifting.
- **H18 The Nest money backend (11.7k LOC) is untracked in git + zero tests + excluded from CI**
  yet packaged for PM2 production.
- **H19 Nest in-memory rate limiter is defeated by PM2 cluster mode** (cap × cores, resets on
  restart).
- **H20/H21 Nest DB queue has no stale-reservation reaper** — jobs in flight at any
  restart/crash are orphaned forever (match/broadcast silently lost).
- **H22 Money-safety concurrency is tested only on SQLite `:memory:`** (locks are no-ops
  there), and that suite auto-deploys to prod Postgres.
- **H23 Runner + admin payout flows (money OUT) have zero tests.**
- **H24 Cancellation-fee / partial-refund math is untested.**
- **H25 The dual-source-of-truth drift** (nest-migration lens; same root as H17).

### 🟡 MEDIUM (56) & 🟢 LOW (8) — highlights

Data model: **no DB-level uniqueness on money tables**, **zero CHECK constraints** (negative
balances / rating outside 1–5 accepted), redundant/duplicate indexes on the hottest tables,
inconsistent FK `ON DELETE` vs. soft-delete (half-cascade). API: three divergent payment-status
probes, inconsistent pagination envelope, status probes 404 for both "not-yet-settled" and
"unknown" (client polls forever). Performance: unbounded `per_page`, `available` errands loaded
unbounded and distance-filtered in PHP, completion recomputes `completion_rate` with two full
`COUNT(*)` scans *inside* the lock. Mobile: pull-to-refresh silently served from cache, runner
Home re-renders on every store write, ~13–17 concurrent preload requests on cold start, unbounded
Axios micro-cache. Realtime: notification `data` double-encoded (breaks deep links), single
overwrite-only push token, realtime uses the public anon key (RLS either blocks delivery or leaks).
Low: users can change their own role via profile update; public trip link has no TTL; the SOS
live-tracking link resolves against the wrong column and always 404s.

---

## 4. Prioritized recommendations (highest → lowest impact)

1. **Close the auth-bypass (C1).** Verify Google `aud`==client-id + `email_verified`; verify
   Facebook via `/debug_token` app-id. Don't auto-link a social identity onto an existing
   password account. *Deploy-coupled: OAuth client IDs must be set in env.*
2. **Add DB-level money integrity (backs H1/H2 + medium DB findings, protects BOTH backends).**
   Partial `UNIQUE(reference_id, type)` on `wallet_transactions`; `UNIQUE(gateway_tx_id)` on
   `payments`; `CHECK(wallet_balance >= 0)`; `CHECK(rating BETWEEN 1 AND 5)`. Make wallet ops
   idempotent and catch the constraint as a no-op.
3. **Fix the money races (H1, H2, H3).** Lock the booking row and re-check status inside the
   transaction; route all payment status changes through `transitionTo()`.
4. **Stop paying for uncollected money (C2).** Gate the runner wallet credit on real
   collection (`payment_status === 'paid'`); model cash commission separately. *(Business-policy
   fork — see the questions at the end.)*
5. **Make safety real or honest (C3, H15).** Integrate an SMS provider and send real
   trusted-contact alerts + delivery status; until then, stop telling users contacts were
   notified. Schedule the ride-duration job and fix the event signature.
6. **Scrub secrets from logs (H7) and fix the OTP delivery stub (H5).**
7. **Move KYC/proofs to a private disk with signed URLs (H6).**
8. **Fix the silent moderation control (H4) and the small clear bugs (H8 reset-expiry, H9
   decline-authz, role-escalation).**
9. **De-risk the architecture (H17/H18/H25):** commit `errandguy-nest` behind review or delete
   it; do not run both schedulers/workers against one DB; add golden-vector parity tests before
   any cutover.
10. **Performance & UX:** async the broadcast fan-out (H16), fix negotiate pricing (H11),
    matched-timeout + runner notify (H12), scheduled-booking UI (H13), masked calls (H14).
11. **Test the money paths on real Postgres (H22–H24)** and gate deploy on it.

---

## 5. Production-readiness assessment

**Verdict: not production-ready as a money- and safety-handling platform without the
critical/high remediations — though the happy-path product is functional and the Laravel
backend is live.**

| Dimension | State |
|---|---|
| Reliability | ⚠️ Sync external I/O on the money path; queue orphans jobs on restart (Nest) |
| Security | 🔴 Auth bypass (C1); secret logging; public KYC; broken suspension |
| Money correctness | 🔴 No DB idempotency; double-credit races; pays uncollected cash |
| Safety | 🔴 SOS/monitors inert; PII exposure |
| Observability | 🔴 No error tracking/APM anywhere; exceptions only hit log files |
| Scalability | ⚠️ Direct (unpooled) DB port in prod; O(N) broadcast; unbounded lists |
| Testing | 🔴 Money concurrency tested on SQLite; payout untested; Nest 0 tests |
| Deployability | ⚠️ Fire-and-forget CI deploy; no migration safety; Nest untracked |
| Maintainability | 🔴 Two hand-synced backends, no shared source of truth |

---

## 6. Roadmap

- **Phase 0 — Stop the bleeding (days):** C1 auth fix, DB integrity migration + idempotent
  wallet ops, H1/H2/H3 race fixes, secret-log scrubbing, honest SOS message, decline/role/reset
  bugs. *(This PR implements the safe subset — see §7.)*
- **Phase 1 — Safety & money truth (1–2 wks):** SMS provider for OTP + SOS + real delivery
  status; schedule/fix safety monitors; private KYC storage + signed URLs; cash-settlement
  model; amount-verification on webhooks; fix suspension.
- **Phase 2 — Architecture decision (1–2 wks):** commit or delete Nest; single-owner for
  schedulers; golden-vector parity tests + Postgres CI + deploy gating; APM/Sentry; DB pooler.
- **Phase 3 — UX & scale (2–4 wks):** negotiate pricing, matched-timeout + notify, scheduled-
  booking flow, masked calls, async broadcast, list caps, mobile render/cache fixes, ledger
  append-only + reconciliation, RLS-scoped realtime JWT.

---

## 7. What this PR implements

Scope = the **unambiguous, data-integrity-preserving, low-breaking-change subset** of Phase 0
(money-safety hardening + clear security bugs) in the **live Laravel backend**. Everything below
is covered by tests and preserves the happy-path behavior. Behavior-*policy* changes (cash
settlement, negotiate pricing, social-login enforcement) are called out for product sign-off
rather than changed unilaterally.

**Cash / uncollected-money settlement (C2 — the biggest money leak; product-approved model):**
- `RunnerErrandController::handleCompletion` now settles by what was **actually collected**, not
  by booking status: *paid* (wallet/online) credits the runner's payout as before; **cash**
  records a negative `commission` entry (the runner keeps the fare in person and owes the
  platform its service fee, which nets against their wallet/future earnings — the balance may go
  negative, which is the debt); *unsettled online* (expired/failed) credits nothing and does not
  mark the payment paid. The platform never again pays out money it didn't receive.

**Money integrity (backs H1, H2, H3 and the medium DB findings):**
- New migration `2026_07_23_000001_add_money_integrity_constraints.php` — a partial
  `UNIQUE(user_id, reference_id, type)` on `wallet_transactions` (kills double-refund /
  double-charge / double-earning at the DB, protecting **both** backends), a partial
  `UNIQUE(gateway_tx_id)` on `payments`, and a `CHECK(rating BETWEEN 1 AND 5)` (Postgres only).
  **Data-safe**: each guard is added only if existing data is clean; on dirty legacy data it logs
  `CRITICAL` and skips (never deletes money rows, never fails the deploy). Scope is
  `(user_id, reference_id, type)` — verified against the referral flow, which legitimately writes
  two `bonus` rows sharing one reference. *(A `wallet_balance >= 0` CHECK was deliberately NOT
  added: the cash-commission model above requires runner balances to go negative. Customer
  overdraft is still prevented at the app layer in `deduct()`/`payout()`.)*
- `WalletService::deduct` / `refund` are now idempotent (lock the user, no-op on a repeat
  `reference_id`+`type`), so a retried/double-tapped charge or refund can't double-apply.

**Concurrency & audit correctness:**
- `RunnerErrandController::updateStatus` now re-reads the booking under `lockForUpdate()` and
  re-checks status inside the transaction — closing the completion double-credit race (H1). A
  raced/retried "completed" returns `409` instead of paying the runner twice.
- Completion marks the payment paid through the audited `Payment::transitionTo()` funnel instead
  of a raw `->update()` (H3) — no more skipped audit rows or laundered illegal transitions.
- `BookingController::cancel` runs the cancel + refund atomically under a booking lock and
  re-checks `payment_status` inside the lock, so a double-tap can't double-refund (H2).

**Security / authz / clear bugs:**
- `OTPService::sendViaSMS` no longer logs the plaintext OTP (CWE-532) and now fails honestly
  (the caller returns `502`) instead of a false "sent" (H5/H7).
- `SOSService` no longer logs the SOS live-link token or contact phone numbers (H7).
- `PasswordResetController` expiry check fixed for Carbon 3 (was never expiring — H8).
- `RunnerErrandController::decline` now rejects a runner declining a booking assigned to
  someone else (H9).

**Tests:** new `tests/Feature/Payment/MoneyIntegrityTest.php` (6 tests) proves the idempotency
guards + the DB constraint (including the referral and payment-vs-refund allow cases); new
`StatusUpdateTest` cases prove cash charges commission (not payout), paid credits payout, and
unsettled online credits nothing. `OTPTest` updated to assert the honest 502. Three stale
`PricingServiceTest` money-guards restored (they didn't account for the intentional per-vehicle
premium). Result: **262 passing / 268**, up from a `251/260` baseline, with **zero regressions
from these changes**.

### Addenda — surfaced while implementing (not in the 15-lens run)

- **Login/register omit the caller's own PII.** `UserResource` reveals `email`, `wallet_balance`,
  and the verification flags only `when($isSelf)`, but `$isSelf` is false during
  login/register (no authenticated request context yet), so those responses return a user object
  **without** email/wallet/verification state. The mobile app may depend on these. *(Medium — left
  for a UserResource-contract decision; it is why 4 of the 6 remaining test failures are red.)*
- **The `errandguy-api` test suite is red on `main` (6 stale tests) and CI does not lint.**
  `backend-ci.yml` runs only `php artisan test`; there is no Pint/style gate, and the repo is not
  Pint-clean. Combined with H22 (SQLite-only money concurrency) the CI "safety net" is weaker than
  it appears. The 6 remaining failures are all pre-existing stale assertions (auth response shape,
  a `429` vs `422` rate-limit code, a more-descriptive status message), not regressions.

### Phase 1 — implemented (follow-up, Laravel API)

- **H4 admin suspension now works.** `suspend()` writes the enforced `status` column
  (was writing a non-existent `is_active`, so it was a silent no-op), records
  `suspended_reason`/`suspended_at` (new migration + fillable), and **revokes the user's live
  tokens** so an authenticated session is cut immediately. The suspended-users admin filter now
  queries `status` (was 500-ing on a nonexistent column).
- **Runner KYC review now works.** `RunnerVerificationController` queried a non-existent
  `user_id` column on `runner_documents` (keyed by the runner *profile* id) — so
  document listing/approve/reject were broken. Now resolved via the profile, and a
  `User::runnerDocuments()` has-many-through was added (fixes the admin user-detail 500 that
  eager-loaded a missing relation).
- **Ride-duration safety monitor now runs.** `CheckRideDurationJob` was never scheduled, had the
  Carbon-3 signed-diff bug (elapsed always negative → never tripped), and constructed its event
  with an id where a `Booking` was required (TypeError). Fixed all three and scheduled it every
  5 minutes (`withoutOverlapping`). *(Trusted-contact SMS delivery is still a Phase-2 stub —
  the pipeline now fires and logs/pushes; real SMS needs a provider.)*
- **Unbounded `per_page` clamped** to `[1,100]` via a shared `$request->perPage()` macro across
  all 8 list endpoints (DoS/large-payload mitigation).

Tests added: `Admin/AdminModerationTest` (5), `Safety/RideDurationMonitorTest` (2). Suite now
**269 passing / 275** (same 6 pre-existing stale failures).

### Phase 2 — implemented (follow-up, Laravel API)

- **H12 — matched bookings no longer strand.** `MatchRunnerJob` now actively **offers** the
  errand to the matched runner (in-app `Notification` row + push) instead of relying on the
  runner to poll. A scheduled `ExpireStaleMatchesJob` (every minute) resets any booking stuck in
  `matched` past `matched_acceptance_timeout_seconds` (default 90) back to `pending` and
  re-dispatches matching **excluding the unresponsive runner** (new optional `excludeUserId` on
  `MatchingService::findRunner`). The existing created_at-based `AutoCancelBookingJob` still
  bounds the total wait, so it can't loop forever. Tests: `StaleMatchReassignTest` (3).
- **Notification deep-links fixed (double-encode).** `notifications.data` is `jsonb` and the
  model casts it to `array`, but five call sites passed `json_encode(...)` (re-encoding it into a
  JSON *string*) and `RealtimeService::insertNotification` did the same for the PostgREST/realtime
  path. The mobile app reads `notification.data` as an object (no `JSON.parse`), so every affected
  notification's deep-link (`data.booking_id`, etc.) silently failed. Both write paths now pass
  the array/object directly. Verified against the mobile consumer before changing. Guard test
  added. *(Existing rows stay as-is — notifications are ephemeral; no backfill.)*

### Phase 3 — implemented (follow-up, Laravel API)

- **H10 — settlement amount tripwire.** The Xendit webhook now compares the gateway-confirmed
  amount (`paid_amount`/`amount`) to the expected `Payment.amount` on `invoice.paid` and
  `payment.succeeded`, logging a `CRITICAL` on any mismatch. Observability-only (the token already
  authenticates the caller and invoices are fixed-amount), so it never refuses a real settlement —
  it just gives ops a reconciliation alarm before money is lost. Guard test added.
- **`available` errands query bounded.** `RunnerErrandController::available` loaded *every* open
  negotiate booking and distance-filtered in PHP. It now applies the same lat/lng bounding-box as
  `MatchingService` in SQL and caps the result at 100 (the precise circle filter still runs) —
  removing an unbounded query / payload risk as open-booking volume grows.

Suite: **274 passing / 280** (6 pre-existing stale failures). Zero regressions.

### Phase 4 — implemented (follow-up, Laravel API)

- **`negotiate_expires_at` single source of truth.** `MatchingService::broadcastToRunners`
  overwrote the expiry with a hardcoded `now()->addMinutes(30)`, clobbering the config-driven
  value (`negotiate_timeout_minutes`, default 5m) that the create path (`BookingController`)
  already sets, anchored to the broadcast time. The overwrite contradicted the config, the
  `ExpireNegotiateBookingJob` scheduled for the create-path instant, the offer payload + client
  countdown, and the runner-accept guard (`negotiate_expires_at > now()`). For immediate bookings
  the broadcast runs synchronously in-request, so the wrong 30m expiry was written *every time*.
  Fix: broadcasting is now a pure read of eligible runners; the create path owns the expiry. The
  unit test was rewritten to assert broadcast *preserves* a pre-set expiry rather than enshrining
  the clobber.
- **Dropped a provably-redundant duplicate index on `messages`.** Two migrations created the
  identical `(booking_id, created_at)` index under different names (`idx_messages_booking_id_created`
  from table creation; `idx_messages_booking_created` from the 2026-05-06 perf migration, whose
  author overlooked that the table-creation migration already had it). Carrying both doubled write
  amplification + storage on a hot, frequently-inserted table for zero read benefit. New migration
  drops the duplicate **only after confirming the keeper still exists** (skips with a `CRITICAL`
  log otherwise, so coverage can never be lost); Postgres uses `DROP INDEX CONCURRENTLY` (no
  `ACCESS EXCLUSIVE` lock on `messages`), SQLite a plain drop; `down()` recreates it. Verified
  up+down on a scratch DB.
- **Considered and declined:** a `bookings(customer_id/runner_id, updated_at)` index for the chat
  inbox sort. The existing single-column FK indexes already make the `customer_id OR runner_id`
  filter fast and a single user's booking set is small, so the `updated_at DESC LIMIT 60` sort is
  cheap and in-memory. Adding the composite would put extra write amplification on the hottest
  table in the system (every status/payment/assignment change bumps `bookings.updated_at`) for a
  marginal gain on a low-QPS interactive screen — a net negative.

Suite: **274 passing / 280** (6 pre-existing stale failures). Zero regressions.

### Phase 5 — implemented (follow-up, Laravel API)

Each candidate was verified against current code and adversarially refuted before implementation.

- **SOS live-tracking link always 404'd (safety).** The SOS token is stored on
  `sos_alerts.live_link_token`, but `PublicTripController::show` only queried
  `bookings.trip_share_token`, so the emergency link the SMS-to-be sends never resolved. Added an
  SOS fallback: resolve the token against an **active, unexpired** `SOSAlert` (60-min TTL) and
  load its booking. Safety deliberately overrides the trip-over status cutoff (an unresolved
  emergency keeps the link live even after the booking closes); access stays gated by the alert
  being `active` + within `live_link_expires_at`, and dies the moment `deactivateSOS` resolves it.
- **Public trip-share link had no TTL (privacy).** Once shared it resolved forever (subject only
  to the booking being non-terminal), leaking live location + addresses to any forwarded URL.
  Added a nullable `bookings.trip_share_expires_at` (new `config/safety.php`, default 24h, env
  `TRIP_SHARE_TTL_HOURS`), set on `share()`, cleared on `revoke()`, and backfilled for
  currently-active links. The public resolver uses a **lenient** predicate (`NULL OR > now()`):
  a legacy/other-backend NULL-expiry link must never 404 a live in-progress trip. (The original
  strict `> now()` proposal was **refuted** for exactly this dual-backend reason.)
- **Completion recompute lightened the row lock (perf).** `handleCompletion` recomputed
  `completion_rate` with two `COUNT(*)` round-trips while holding the booking + runner row locks;
  collapsed to a single conditional-aggregation query (`SUM(CASE WHEN status='completed'…)` over
  the assigned set) — byte-identical result, one round-trip under the lock.
- **Verified & DROPPED as misdiagnosed:** (a) *profile role self-escalation* — the `role` rule
  whitelists `customer|runner` only, admins authenticate via a separate `AdminUser` guard, and
  other fields are stripped by `validated()`; the customer→runner switch is intended onboarding
  gated by `verification_status==='approved'`. (b) *payment-status-probe 404* — every pending
  payment row is created synchronously before the gateway call, so pending/processing return
  **200**; only a genuinely-unknown id 404s, which the mobile `usePaymentVerification` hook
  deliberately treats as "keep polling," not failure.
- **Follow-ups surfaced (not blocking):** the `/trip` payload still shows the *runner's* live GPS
  even for a *customer*-triggered SOS (the alert's captured `customer_lat/lng` isn't surfaced);
  `sos_alerts.live_link_token` has no dedicated index (fine under the 60/min throttle + short
  TTL); and the Nest port must mirror the `trip_share_expires_at` column + lenient filter before
  it can serve `/trip` without reopening the leak.

Tests: **+8** (trip TTL incl. the null-expiry lenient case, SOS link resolve/expire/resolved,
completion-rate `1/2 = 50.00` regression guard). Suite **282 passing / 288** (same 6 pre-existing
stale failures). Zero regressions.

### Phase 6 — implemented (follow-up, Laravel API): API contract-hardening

Preceded by a two-agent map of every payment-status probe and every list endpoint's envelope
**and their mobile consumers**, so the consolidation could be proven backward-compatible. Key
finding: the mobile client reads list rows at `res.data.data` in *every* envelope shape and the
payment poll reads only stable keys (`status`, `amount`, `paid_at ?? processed_at`, `reference`,
`method`, `failure_reason`) with `'completed'` as the sole success token — so an **additive**
change needs no mobile release.

- **Unified the 3 payment-status probes** (`/payments/{id}/status`, `/bookings/{id}/payment-status`,
  `/wallet/transactions/{id}/status`) onto one self-describing contract, additively: added `kind`
  (`payment`|`wallet_topup`), a canonical `id` alias, and a canonical `settled_at` alias to all
  three while keeping every existing key (`payment_id`/`transaction_id`/`paid_at`/`processed_at`).
  Widened `failure_reason` to **all** terminal-failure states (was payment `failed/expired`,
  wallet `failed` only — `cancelled/refunded` wrongly returned null). Fixed the
  `/bookings/{id}/payment-status` **404-overload**: a booking that exists but has no `Payment` row
  yet now returns an honest `200 pending` (`id:null`); unknown/foreign bookings still `404`.
- **Canonical pagination envelope.** Converted `/wallet/transactions` from the raw flat paginator
  to the nested-meta `{data, links, meta}` shape every other paginated list uses (also stops
  leaking absolute server URLs). Rows stay at `.data.data`, so all three mobile consumers are
  unaffected.
- **Deliberately DEFERRED:** the 5 `/admin/*` flat-paginator endpoints feed a **separate admin web
  dashboard not in this repo** — converting their envelope (or applying the `perPage` macro) could
  break that unverifiable client, so they're left unchanged pending admin-dashboard coordination
  (same discipline as H6). Documented for a coordinated pass.

Tests: **+5** (canonical probe contract, pre-charge pending vs 404, wallet nested-meta envelope,
`transactionStatus` contract). Suite **287 passing / 293** (same 6 pre-existing stale failures).
Zero regressions.

### Phase 7 — implemented (follow-up, **mobile** — errandguy-mobile)

First backend-free phase (the mobile working tree was clean, so no collision with in-progress
edits). Each of four perf findings was verified against current code and adversarially refuted
before implementation; the fixes are pure client-side, no API contract change.

- **Runner Home re-rendered on every GPS tick** (~every 6s while online): it subscribed to
  `useLocationStore()` with no selector, so each `currentLocation` write re-rendered the whole
  screen for data it never renders. Switched to atomic action selectors (stable refs); the screen
  reads no location field reactively (only an imperative `getState()`), so no re-render is lost.
- **Cold-start preload fired ~13–16 GETs at once**, starving the landing screen's own fetches.
  Extracted a reusable bounded-concurrency `runPool()` (`src/utils/asyncPool.ts`, limit 4) and ran
  both `preload*Essentials` task lists through it as thunks, above-the-fold data first. Same
  keys/TTLs/fetchers — only *when* each fires changes; any screen reached early still falls back to
  its own `useQuery` + in-flight dedup.
- **Pull-to-refresh silently served the ≤8s micro-cache.** `useQuery.refresh` now calls
  `apiCache.clearResponses()` (clears cached responses, keeps the in-flight dedup map) before
  revalidating. URL-agnostic — the originally-proposed per-key invalidate was **refuted** because
  the semantic `key[0]` (`'payment-methods'`, `'runner'`) doesn't substring-match the REST URL, so
  it no-oped on exactly the money screens.
- **Axios micro-cache was unbounded** (grew for the whole session). Added a write-recency LRU
  (`MAX_CACHE_ENTRIES = 100`) via `setCache()`; eviction only ever causes a correctness-preserving
  fresh fetch, never a stale serve, and `ts` is never restamped on read so the TTL still bounds
  staleness.

Tests: **+3** (`runPool` concurrency-cap / run-all / failure-isolation). `tsc --noEmit` clean;
jest **143 / 144** (the 1 failure is the pre-existing `authStore.loadFromStorage` test). Zero
regressions.

### Phase 8 — implemented (H13, **backend + mobile**): scheduled bookings + no-runner refund

Two product/policy decisions were taken with the user first (scheduled → confirmation-then-Activity;
auto-refund on no_runner) before touching the money flow.

- **Auto-refund when no runner is ever matched (money).** A booking reaching `no_runner`
  (`MatchRunnerJob`) or auto-cancelled for no runner within the timeout (`AutoCancelBookingJob`)
  had money collected up front (online/wallet) but was never refunded — the platform kept money
  for undelivered service, and "Book again" risked a second charge on top. Added
  `BookingService::refundUnfulfilled()`: a locked, idempotent, **full** refund (no fee — no fault)
  to the wallet, reusing `WalletService::refund` idempotency + the `Payment` state machine. Wired
  into both no-runner paths; cash / unpaid / already-refunded bookings are a no-op. "Book again" is
  now a clean separate booking → no double-charge.
- **Scheduled bookings no longer show a false "searching → no runners" failure (mobile).**
  `book/confirm.tsx` unconditionally ran the live searching radar + 60s countdown that times out to
  "No runners available" — but the server delays matching for a scheduled booking until near its
  slot, so a booking scheduled for later *always* showed a bogus failure. `confirm` now detects a
  future `scheduled_at` and shows a calm "Booking scheduled · &lt;time&gt;" confirmation with a Done →
  Activity button instead (matching runs automatically near the slot); handles cold-start / Xendit
  deep-link hydration too.

Tests: **+3** backend (paid → full refund, cash → no refund, idempotent). API suite **290 / 296**
(same 6 pre-existing stale failures); mobile `tsc` clean, jest **143 / 144**. Zero regressions.

### Phase 9 — implemented (H11, backend): negotiate mode charges the offer

Product decisions taken with the user first: the offer IS the total the customer pays, and the
platform keeps its **flat** computed service fee (offer only changes the runner's share).

- Negotiate pricing was a no-op — `customer_offer` was validated, stored, and broadcast, but
  `total_amount`/`runner_payout` were set to the FIXED distance/vehicle fare, so the customer was
  charged the fixed price (not their offer) and the mobile slider value never matched what the
  backend billed. Added `PricingService::applyNegotiateOffer()` (`total_amount = offer`,
  `runner_payout = max(0, offer − service_fee)`) applied in `BookingController::store` for negotiate
  bookings, before the promo block so a promo discounts the offer. Payment (wallet deduct / Xendit
  invoice) now bills the offer; an unmatched negotiate booking is returned by the Phase-8 no-runner
  auto-refund.

Tests: **+3** (`applyNegotiateOffer` total/flat-fee/payout, payout-never-negative clamp, negotiate
booking charged the offer end-to-end). API suite **293 / 299** (same 6 pre-existing stale failures).
Zero regressions.

### Phase 10 — implemented (H16, backend): bulk offer broadcast

- Broadcasting a negotiate booking looped over eligible runners with one sequential Supabase REST
  insert **per runner** (`BroadcastToRunnersJob` → `RealtimeService::broadcastIncomingRequest`).
  For immediate bookings this runs synchronously in the create request, so create latency scaled
  linearly with the runner count and a slow Supabase could stack N timeouts. Added
  `RealtimeService::insertNotifications()` — a single PostgREST **bulk** insert (array body) that is
  O(1) HTTP round-trips regardless of N, keeping the existing sync model (no queue-worker
  dependency). Each row's jsonb `data` is still a real object, so realtime fan-out + mobile
  deep-links are unaffected.

Tests: **+2** (N notifications → one request with an N-row array body; empty list is a no-op). API
suite **295 / 301** (same 6 pre-existing stale failures). Zero regressions.

### Phase 11 — implemented (backend): multi-device push tokens

- Push delivery keyed on a single `users.fcm_token` column overwritten on every device
  registration — signing in on a second device silently stopped the first from receiving pushes,
  and stale tokens were never cleaned up. Added a one-to-many `device_tokens` table (unique per
  token, cascade on hard user-delete) with a **backfill** of existing `fcm_token` values so no
  device loses push on deploy. Registration upserts the device row (keyed by token → re-register
  re-points rather than duplicates) while still writing the legacy column for backward compat.
  `NotificationService::sendPush` now fans out to ALL of a user's devices (Expo in one batched
  call, FCM one by one) and **prunes** any token Expo reports `DeviceNotRegistered`; falls back to
  the legacy column for pre-migration users. Account deletion drops the user's device tokens (the
  FK cascade only fires on a hard delete; this is a soft delete).

Tests: **+5** (register creates a row + keeps legacy; re-register de-dupes; fan-out is one Expo
call; `DeviceNotRegistered` pruned; legacy fallback); backfill + `down()` verified on a scratch DB.
API suite **300 / 306** (same 6 pre-existing stale failures). Zero regressions. NOTE: a `device_id`
from the mobile client + Expo receipt-polling (vs the immediate-ticket prune) would harden this
further — a reasonable follow-up, not required for correctness.

### Phase 12 — implemented (Nest port): first test harness + money-parity guard

Decision taken with the user: **keep** the Nest port and pin it with parity tests (vs retiring it).

- The Nest port had **zero** tests and no working jest config (its `test:e2e` script pointed at a
  non-existent file) while running money logic on the same Supabase DB as Laravel prod — the
  audit's #1 risk. Added a minimal unit harness (`jest.config.js`, ts-jest transpile-only; full
  type-check stays with `npm run typecheck`) and the first parity spec: `PricingService` pinned to
  Laravel's **exact** outputs — 15%-of-subtotal service fee, `total = subtotal + fee + surcharge`,
  `runner_payout = total − fee` (clamped), canonical vehicle premiums (0/10/25/60), plus `applyPromo`.
  Verified: `npm run typecheck` clean, `npx jest` 8/8, `nest build` clean.
- **Documented parity gaps to close next** (Nest is committed but not deployed, so these are latent):
  (1) Nest wallet `deduct`/`refund` lack Laravel's app-level idempotency guard — the shared DB
  partial-unique index `uq_wallet_tx_user_reference_type` is the cross-backend backstop; (2) Nest
  booking-create does not apply the negotiate `customer_offer` (Laravel H11), so a Nest-served
  negotiate booking would still charge the fixed fare; (3) Nest has no no-runner auto-refund (H13).
  Wallet/settlement parity needs DB-backed integration specs (Nest uses raw `FOR UPDATE`).

### Phase 13 — implemented (Nest parity + a Laravel prod gap it surfaced)

Brought the Nest port up to Laravel's money behavior, and fixed one real production gap the parity
work exposed.

- **Nest H11** — `PricingService.applyNegotiateOffer` + applied in booking-create (before promo):
  a negotiate booking now charges the customer's offer, not the fixed fare. **Nest wallet
  idempotency** — `deduct`/`refund` return an existing transaction for the same
  `(user, reference, type)` instead of double-charging/refunding (Laravel's Phase-0 guard; the DB
  unique index is still the hard backstop). **Nest H13** — `BookingService.refundUnfulfilled`
  (full refund, no fee, idempotent) wired into all three unmatched-paid paths (`matchRunner`→
  `no_runner`, auto-cancel sweep, negotiate-expire sweep).
- **Laravel (production) gap:** `ExpireNegotiateBookingJob` cancelled an expired negotiate booking
  **without refunding**. Since Phase-9 H11 now charges the offer up front, a paid negotiate booking
  that expired with no acceptance kept the customer's money — wired in `refundUnfulfilled`.

Tests: Nest jest **10/10** (typecheck + `nest build` clean), +2 `applyNegotiateOffer` parity
specs. Laravel **+1** (expired negotiate booking refunds the paid offer), suite **301/307** (same 6
pre-existing stale failures). Zero regressions. Remaining Nest parity: DB-backed specs for wallet
idempotency / `refundUnfulfilled` need a Postgres test DB (raw `FOR UPDATE` isn't unit-testable).

### H6 (private KYC storage) — assessed, deliberately deferred with a plan

Not shipped this pass because it cannot be done safely blind: the fix requires (1) an **infra
decision** — make the KYC/delivery-proof storage private (a Supabase bucket-privacy flip, or move
off Laravel's local `public` disk); (2) a **contract change** — serve documents to admins via
short-lived **signed URLs** instead of the permanent public URL currently stored in
`runner_documents.file_url`; and (3) a **backfill** of existing files. Crucially, the **admin
panel that consumes `file_url` is not in this repo**, so I can't verify the change won't break KYC
review. Recommended staged plan: add `createSignedUrl()` to `SupabaseStorageService`
(`/storage/v1/object/sign/...`) → mark the `runner-documents` / `delivery-proofs` buckets private
→ route uploads through `SupabaseStorageService` and store the object *path* (not a public URL) →
generate a signed URL at read-time in `RunnerDocumentResource` / the admin document endpoint →
backfill. Happy to implement once the storage decision + admin-panel consumer are confirmed.

### Deliberately NOT changed here (need product sign-off / infra)

- **C1 social-login audience verification** — *product decision: HOLD.* The correct fix (reject
  tokens whose `aud` ≠ your OAuth client ID; Facebook `/debug_token` app-id) requires the client
  IDs in env; enforcing without them set would reject all social logins. Documented for a
  coordinated config + rollout. **This is still an open account-takeover vector until shipped.**
- **C3 SOS SMS delivery / H15 safety monitors** — need a real SMS provider (Semaphore/Twilio)
  and credentials; this change only stops the secret-leak and the false "notified" log. Wiring a
  provider + scheduling the ride-duration job + fixing the event signature is Phase 1.
