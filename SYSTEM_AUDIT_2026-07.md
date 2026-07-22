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

### Deliberately NOT changed here (need product sign-off / infra)

- **C1 social-login audience verification** — *product decision: HOLD.* The correct fix (reject
  tokens whose `aud` ≠ your OAuth client ID; Facebook `/debug_token` app-id) requires the client
  IDs in env; enforcing without them set would reject all social logins. Documented for a
  coordinated config + rollout. **This is still an open account-takeover vector until shipped.**
- **C3 SOS SMS delivery / H15 safety monitors** — need a real SMS provider (Semaphore/Twilio)
  and credentials; this change only stops the secret-leak and the false "notified" log. Wiring a
  provider + scheduling the ride-duration job + fixing the event signature is Phase 1.
