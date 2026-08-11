# ErrandGuy — Production Readiness Audit & Comprehensive Gap Analysis (v3, current-state)

**Date:** 2026-08-12
**Method:** Independent multi-agent audit — 15 dimension lenses read the current tree, each finding adversarially re-verified against the code, then synthesized. 28 agents, 482 file reads.
**Supersedes:** `PRODUCTION_READINESS_AUDIT_2026-08.md` (the pre-remediation 58/100 sweep). This audit is run *after* this session's ~15 remediation commits and credits/verifies them rather than re-reporting fixed issues.

---

## 1. Executive Summary

ErrandGuy is a two-sided, on-demand errands/delivery marketplace (Laravel 13 API + Filament admin, Expo/React-Native customer+runner app, MySQL 8, Reverb realtime, Xendit payments). Since the prior audit the **transactional money core and its reliability backstops were rebuilt to a genuinely strong standard** — and this audit independently *verified* those fixes hold rather than trusting the changelog.

The headline: **the code that moves money is now the strongest part of the system; the weakest parts are now operational (DR, alerting, safe-deploy), admin authorization, and privacy/DPA compliance.** The risk has shifted from "the ledger might lose money" (largely closed) to "we can't recover from a disaster, we won't be paged when our own money-integrity alarm fires, any admin can move money through an unaudited API, and we leak PII into logs."

- **89 findings:** 🔴 1 critical · 🟠 22 high · 🟡 36 medium · 🟢 30 low.
- **Strongest dimensions:** Money-safety (83), Mobile UX (82), Backend performance (82).
- **Weakest dimensions:** Admin/Ops (57), DevOps/Observability (58), Privacy/Compliance (58).
- **The single critical:** no database backup / PITR anywhere, and the deploy runs an irreversible `migrate --force` with no snapshot, health gate, or rollback — unacceptable for a payments database.

The app is **materially closer to launch than the prior 58/100** but is **not yet launch-ready**. The remaining blockers are concentrated and mostly addressable; several are one-line safe code fixes (PII log redaction, re-enable font scaling, admin API authorization), several are configuration/ops the team controls (backups, Sentry DSN, `APP_DEBUG=false`), and a few are genuine product decisions (pricing/VAT policy).

---

## 2. What the Application Actually Does (from the code)

- **Customers** register (email/phone + strict password + OTP), create errands (fixed-price or negotiate-offer; immediate or scheduled; single- or multi-stop; delivery/pabili/transport), pay via wallet, GCash/Maya/GrabPay/card (Xendit), or cash-on-completion; track the runner live on a map; chat; tip; rate; and trigger SOS.
- **Runners** onboard with KYC documents (gov ID/selfie/license) + manual admin approval, go online, receive fixed-price match pushes and negotiate-offer broadcasts, accept/decline, run a live errand cockpit (PIN-verified handoffs, shopping checklist), earn to a withdrawable wallet, and request payouts.
- **Admins** (Filament panel `/admin`, session-guarded, with role tiers) approve KYC, adjust wallets, refund, disburse payouts, resolve disputes, run an SOS response console, and edit pricing/promo/system config. A **parallel REST admin API** also exists.
- **Money model:** withdrawable `wallet_balance` + non-withdrawable `bonus_balance`; an append-only `wallet_transactions` ledger with `balance_after`; idempotency middleware + `webhook_events` dedup; a daily wallet reconciler and a wall-clock stranded-booking reaper.

---

## 3. Production Readiness Score

# 66 / 100  —  NOT yet launch-ready (up from 58)

**Justification.** Readiness is weighted by launch-blocking risk, not a simple mean (the mean dimension score is 72.8). The money/ledger core (83), UX (82), and backend performance (82) are launch-grade. But a payments platform **cannot** launch while:

1. there is **no DB backup / PITR and no safe/reversible deploy** (🔴 critical — data-loss and un-rollback-able schema risk on the money DB);
2. its own **CRITICAL money-integrity and prod-config alarms have no delivery path** — they land in a 14-day local log file, so nobody is paged (🟠);
3. a **parallel admin REST API enforces no role authorization and writes no audit trail** — any active admin token can complete/fail payouts, suspend users, and cancel bookings that the Filament UI restricts to finance/super-admin (🟠);
4. **PII leaks into logs** (a trusted-contact phone in cleartext; the SOS/trip-share token via full-URL logging) and **right-to-erasure is incomplete** (chat content/images survive deletion), against RA 10173 (🟠 cluster).

These are concentrated in three dimensions (Admin/Ops 57, DevOps 58, Privacy 58) and are mostly cheap to close. Clear the critical + the operational/authz/privacy highs and this is an ~80/100, launch-ready system.

### Per-dimension scores

| Dimension | Score | One-line state |
|---|:--:|---|
| Money-safety & payments | 83 | Ledger primitives are lock+transaction+idempotent and verified; residual risk at the pre-settlement dispatch seam. |
| Mobile UX & accessibility | 82 | Among the strongest layers; one systemic a11y regression (font scaling disabled). |
| Backend performance | 82 | Bounded queries, ETag/SWR, fail-fast timeouts; a few remaining hot-path edges. |
| Data model & schema | 78 | Money schema well-guarded; lifecycle columns are bare VARCHARs with no DB enum/CHECK. |
| Mobile architecture | 78 | Mature data-fetch/state core; UI debt in three god-screens + `as any` erosion. |
| Product & journeys | 79 | Coherent; a pre-auth permission gauntlet and guest/browse gaps. |
| Booking lifecycle & matching | 74 | Concurrency/settlement solid; scheduling gates + abandonment recovery weak. |
| QA & test coverage | 74 | Strong happy-path + dual-engine CI; gateway-failure & real-concurrency untested. |
| Realtime | 74 | RT-1..RT-5 hold; runner cockpit + live read-receipts don't behave as advertised. |
| Backend architecture | 73 | Money services clean; `BookingController::store()` god-method + no `BookingStatus` enum. |
| Security | 72 | Solid controls; KYC docs still on public disk (SEC-1 partial), no admin MFA. |
| Scalability & reliability | 70 | Great money backstops; 24h-mutex stall risk, single-node queue/cache/broadcast. |
| Privacy & compliance | 58 | Good primitives; PII-in-logs leaks, incomplete erasure, placeholder DPA notice. |
| DevOps & observability | 58 | Real CI + health + reconciler; no DR, no alerting delivery, unsafe deploy. |
| Admin panel & ops tooling | 57 | Filament is money-safe; the REST admin API has no authz and no audit. |

---

## 4–11. Dimension Assessments

**Architecture (73).** The money-critical service layer is genuinely strong: `WalletService` (967 lines) makes every balance mutation `lockForUpdate` + `DB::transaction` + idempotent with bucket-aware refunds; `PaymentService`, `BookingSettlementService`, and the per-event-split `XenditWebhookController` are race-safe and well-documented. The debt is on the customer surface: `BookingController::store()` is a ~475-line god-method with five near-duplicated payment branches, and a parallel `PaymentService::processBookingPayment()` doing the same job is **dead code that will drift**. There is no `BookingStatus` enum (status strings hardcoded in 15+ inline arrays that already disagree), `booking_number` is generated three ways (two bypass the collision-safe helper), and Haversine is copy-pasted in four classes.

**Business logic (74).** Concurrency and settlement are well-remediated and hold. Remaining: scheduled-negotiate bookings are acceptable immediately (scheduling defeated), non-money lifecycle metrics are thin, and the known gaps (runner post-accept abandonment recovery BOOK-2, pabili goods-cost settlement BOOK-3, Haversine-vs-routed pricing PRICE-1) persist.

**UX (82).** One of the strongest layers — honest empty/error/loading states, inline form validation with 422 field-mapping, documented touch-target math, screen-reader paths on custom controls. The serious blemish is a **systemic a11y regression: font scaling is globally disabled** (`maxFontSizeMultiplier`/`allowFontScaling=false` app-wide), so the app ignores the OS display-size setting entirely (WCAG 1.4.4). Secondary: reduce-motion ignored by 8 components despite the infra existing; icon-only tabs; dark mode still deferred (product decision).

**Performance (82).** Bounded eligible-runner queries (bounding-box + SQL nearest + limit), ETag/304 reuse, in-flight dedupe + LRU micro-cache on the client, fail-fast Reverb/Expo timeouts. Remaining hot-path edges are in the medium findings.

**Security (72).** Solid: `hash_equals` webhook token + dedup, UUID-safe participant-gated channels, user-scoped payment/wallet endpoints (no IDOR found), CSPRNG+hashed+TTL+capped OTP, hashed reset tokens, credential+IP login lockout, locked-down CSP/HSTS. Held back by **KYC identity docs still on the public disk** (SEC-1 only partially fixed on main — the full private-disk fix is on an unmerged branch), no admin MFA, a new forgot-password account-existence oracle, chat images on the public disk, and not-safe-by-default proxy trust.

**Scalability (70).** Excellent money backstops, but: all three scheduled safety tasks use `withoutOverlapping()` with Laravel 13's **24h default mutex TTL on file cache** — one hard-killed run silences the reaper for up to a day; the stale-match rescue and overdue-ride **safety monitor run via `Schedule::job` (queue-worker-dependent)** unlike the reaper; `queue=database` + Reverb scaling off + no Redis = single-node ceiling; the MySQL connection lacks the pooling tuning the legacy pgsql block had.

**Maintainability (73/78).** Money services are clean and documented; the debt is the god-controller, the missing status enum, three god-screens (2875/2563/1788 lines), and 145 `as any` casts reaching the estimate/money path.

---

## 12–13. Complete Findings Register (root cause + production-grade fix per item)

*Grouped by dimension, most-severe first. `status`: `new` (surfaced this audit), `known-open` (previously identified, still open), `partially-fixed` (remediation incomplete), `regression` (reintroduced). Every finding cites `file:line` an agent actually read; re-verify line numbers before editing.*


### devops

**🔴 CRITICAL · No DB backup / PITR and deploy runs irreversible migrate --force with no maintenance window, health gate, or rollback**  `[known-open]`
- **Where:** `errandguy-api/deploy.sh:24`
- **Evidence:** deploy.sh pulls, composer installs, optimizes, then runs `php artisan migrate --force` (line 24) directly against production MySQL with no preceding `php artisan down` (no maintenance mode), no pre-migration DB dump/snapshot, and no post-deploy smoke/health check gating the FPM reload at lines 32-33. composer.json shows only spatie/laravel-activitylog, spatie/laravel-data, spatie/laravel-query-builder — no spatie/laravel-backup or any backup mechanism. There is no rollback path: a bad or half-applied migration leaves prod broken with no automated recovery.
- **Root cause:** Deployment was written for the happy path only; DR (backups/PITR) was treated as off-repo Forge config and never scripted or documented, and the migrate step has no safety envelope.
- **Fix:** Add a mysqldump/Forge DB backup (or spatie/laravel-backup) in deploy.sh BEFORE migrate, wrap schema changes in `php artisan down`/`up` or use expand-contract migrations, add a post-migrate `curl -f $APP_URL/up` health gate that aborts+alerts on failure, and document the Forge managed-DB automated-backup + PITR retention as a required launch checklist item. Confirm APP_DEBUG=false separately.

**🟠 HIGH · No error tracking / alerting: CRITICAL money-integrity and prod-config logs have no delivery path**  `[known-open]`
- **Where:** `errandguy-api/config/logging.php:76`
- **Evidence:** composer.json has no Sentry/Bugsnag/Flare — only laravel/telescope (a local debug tool, not prod alerting). ReconcileWalletsCommand and CheckProductionConfig emit Log::critical/warning; CheckProductionConfig.php:14 still admits 'once error-tracking is wired, alerting' i.e. not wired. The only alert-capable channel is 'slack' (logging.php:76) keyed on LOG_SLACK_WEBHOOK_URL, but that var is in NEITHER .env.example NOR .env.production.example, and the prod template sets LOG_STACK=daily only (line 20). So a wallet-vs-ledger divergence or APP_DEBUG-left-on fires into a 14-day local rotating file that nobody is paged on.
- **Root cause:** Observability was built as 'write good structured logs' without the second half — shipping/alerting on them. The detective controls exist but their output is a dead letter.
- **Fix:** Add Sentry, or wire the existing slack channel: set LOG_SLACK_WEBHOOK_URL in the prod template and LOG_STACK=daily,slack so level>=critical pages. Route ReconcileWalletsCommand divergence and CheckProductionConfig criticals to it explicitly.

**🟠 HIGH · Scheduler has no onOneServer() and no heartbeat/pingOnFailure — money-safety backstops can silently stop or double-run**  `[new]`
- **Where:** `errandguy-api/routes/console.php:28`
- **Evidence:** Every Schedule::command/job (cleanup-locations, prune-dedup, check-prod-config, reconcile-wallets, CheckRideDurationJob, ExpireStaleMatchesJob, reap-stranded-bookings) uses only ->daily()/->everyFiveMinutes()/->everyMinute()->withoutOverlapping(). None use ->onOneServer() (so on >1 app server they run on ALL — double reconcile/reap), and none use ->pingOnSuccess/->pingOnFailure/->emailOutputOnFailure or any dead-man's-switch. If the Forge `schedule:run` cron is not installed or dies, the entire money-safety net (stranded-booking refunds, wallet reconciliation) silently stops with zero signal.
- **Root cause:** The schedule was designed assuming exactly one server and an always-healthy cron; there is no self-monitoring that the scheduler itself executed.
- **Fix:** Add ->onOneServer() to every entry (uses the shared Redis cache lock already in prod), and add ->pingOnFailure()/a healthchecks.io-style heartbeat ping on the reaper+reconciler so a stalled cron is detected within minutes.

**🟠 HIGH · Safety monitor CheckRideDurationJob runs via Schedule::job (queue-dependent) — dies silently if the worker is down**  `[new]`
- **Where:** `errandguy-api/routes/console.php:49`
- **Evidence:** CheckRideDurationJob (in-transit ride-overrun SAFETY alert, line 49) and ExpireStaleMatchesJob (line 56) are dispatched with Schedule::job(...), which enqueues to the Redis worker. The reap-stranded backstop at lines 66-68 deliberately uses Schedule::command with the comment 'so it runs in the scheduler process and survives a queue-worker outage — the exact failure it guards against.' The safety-duration monitor did NOT get the same treatment, so a worker outage — the very scenario that also strands rides — silently disables the overrun safety alert.
- **Root cause:** The worker-independence lesson (SCALE-REL-1/5) was applied to the booking reaper but not to the safety-monitor job, leaving an inconsistent reliability boundary.
- **Fix:** Convert CheckRideDurationJob to a Schedule::command (an artisan command that runs the check synchronously in the scheduler process), matching the reaper, so the safety alert does not depend on queue-worker health.

**🟡 MEDIUM · CI deploy step is fire-and-forget `curl -s` — Forge deploy failures report success to GitHub**  `[new]`
- **Where:** `.github/workflows/backend-ci.yml:171-173`
- **Evidence:** The deploy job's only action is `curl -s -X POST "${{ secrets.FORGE_DEPLOY_URL }}"`. `-s` silences errors and there is no `-f`/`--fail`, no `--fail-with-body`, no HTTP-status assertion, and no polling of Forge's deploy result. A 4xx/5xx from Forge (bad token, deploy script failure) still exits 0, so the GitHub Actions run goes green while prod is un-deployed or half-deployed — no signal to anyone.
- **Root cause:** The deploy trigger was wired as the minimum viable webhook call without treating the deploy outcome as a checkable result.
- **Fix:** Use `curl -fsS --fail-with-body` and assert the response, or use the Forge API to trigger the deploy and poll the deployment status until success/failure so the job fails loudly on a broken deploy.

**🟡 MEDIUM · Production EAS profile ships a placeholder Reverb key — realtime would be dead in a prod build**  `[new]`
- **Where:** `errandguy-mobile/eas.json:37-45`
- **Evidence:** The production build profile sets EXPO_PUBLIC_REVERB_KEY: "REPLACE_WITH_REVERB_APP_KEY" (a literal placeholder), while development and preview profiles carry a real key. A `eas build --profile production` (triggerable today via the frontend-ci.yml production-build job on a v* tag) would ship an app that cannot authenticate to Reverb → no chat, no live tracking, no realtime notifications in production. It also points EXPO_PUBLIC_API_URL at api.errandguy.app while dev/preview use the live errandguy-4stnztcd.on-forge.com host, so the prod domain cutover is unverified.
- **Root cause:** The production env block was scaffolded with placeholders and never filled in / validated before the production-build CI path was wired live.
- **Fix:** Populate the production Reverb key from EAS secrets (or reference an EAS environment secret rather than an inline placeholder), and gate the production-build job on a check that no env value equals a REPLACE_WITH_* sentinel. Confirm api.errandguy.app is live before a prod build.

**🟡 MEDIUM · Logs are local-disk only (14-day rotation) — no centralized/off-box log shipping wired**  `[new]`
- **Where:** `errandguy-api/.env.production.example:18-22`
- **Evidence:** Prod template sets LOG_CHANNEL=stack, LOG_STACK=daily, meaning logs write to storage/logs on the single Forge box with 14-day retention (logging.php:72). A 'papertrail' monolog channel is defined (logging.php:85-95) but PAPERTRAIL_URL/PORT appear in neither env template, so it is inert. If the box is rebuilt/lost, or an incident needs >14 days of forensic history (money disputes, fraud investigations), the audit trail is gone with the instance.
- **Root cause:** Centralized log aggregation was treated as optional infra and never wired into the production env or deploy.
- **Fix:** Wire a log-shipping target (Papertrail/Logtail/CloudWatch) via the papertrail/stderr channel + env vars, or at minimum extend LOG_DAILY_DAYS and ship storage/logs to durable off-box storage on a schedule.


### admin-ops

**🟠 HIGH · REST admin API enforces no role authorization — any active admin can move money**  `[new]`
- **Where:** `app/Http/Middleware/EnsureAdminUser.php:18-35`
- **Evidence:** EnsureAdminUser::handle only verifies the caller is an AdminUser instance and is_active (lines 21-33); it never inspects $user->role. The admin route group (routes/api.php:351 middleware ['auth:sanctum','admin']) hangs payout complete/fail (routes/api.php:377-379 -> AdminPayoutController), payment-methods PUT (382-383 -> PaymentSettingController::update), user suspend/unsuspend (359-360 -> UserManagementController), booking cancel (368) and dispute resolve/escalate (372-373) off that single gate. Grep for canManageMoney/canHandleSupport/hasRole/hasAnyRole/->role across app/Http/Controllers/Admin/ returns NOTHING — no controller re-checks the role. The model has canManageMoney()/canHandleSupport() (AdminUser.php:117-134) but they are consumed only by the Filament layer.
- **Root cause:** Authorization for the API admin surface was never implemented; role gating lives only in the Filament layer (Resource canViewAny / action visible() / Payouts::canAccess canManageMoney), so the two admin surfaces have divergent access policies over the same money operations.
- **Fix:** Add a role check to EnsureAdminUser or a dedicated 'admin.money' middleware calling canManageMoney(), and split the admin route group so payout/payment-method/dispute/wallet endpoints require finance/super_admin while read/support endpoints require canHandleSupport(). Mirror the Filament role matrix exactly.

**🟠 HIGH · API admin money & user actions are not audit-logged**  `[new]`
- **Where:** `app/Http/Controllers/Admin/AdminPayoutController.php:39-63`
- **Evidence:** markCompleted and markFailed call WalletService::completePayout/failPayout (failPayout re-credits the runner wallet) and return, with no AdminActivity::log call. Grep for AdminActivity/activity( across app/Http/Controllers/Admin returns nothing (0 hits), covering UserManagementController::suspend/unsuspend, BookingManagementController::cancel and PaymentSettingController::update as well. The equivalent Filament actions DO audit (Payouts.php:259 audit:'payout.completed', :287 'payout.failed', :331 AdminActivity::log('payout.sent')), so an identical money action is audited in one surface and invisible in the other.
- **Root cause:** Audit logging was bolted onto the Filament AdminNotify/AdminActivity helper only; the older REST admin controllers were never retrofitted, so a full unaudited money path exists in parallel.
- **Fix:** Call AdminActivity::log('payout.completed'|'payout.failed'|'user.suspended'|'payment_methods.updated', $subject, [...]) in each API admin controller after the mutation succeeds, matching the Filament event names so both surfaces feed one trail.

**🟠 HIGH · No MFA on any admin surface (ADMIN-1 still fully open)**  `[known-open]`
- **Where:** `app/Providers/Filament/AdminPanelProvider.php:115-117`
- **Evidence:** authMiddleware is just [Authenticate::class] — no ->multiFactorAuthentication(...). AdminAuthController::login issues a Sanctum token on email+password with no second factor. AdminUser hides a two_factor_secret column (AdminUser.php:51) but grep shows it appears ONLY in the $hidden array — nothing reads/writes it, the field is vestigial. Real money leaves the platform (Payouts 'Send via Xendit', PaymentsTable refund, ViewUser adjustWallet) behind a single password.
- **Root cause:** MFA was scaffolded (hidden column) but never wired into either the Filament login or the API login.
- **Fix:** Enable Filament v4 app-authentication MFA (->multiFactorAuthentication(AppAuthentication::make()->recoverable())) and enforce it at least for canManageMoney roles; add TOTP verification to the API login path. Optionally restrict /admin by IP allowlist as defense-in-depth.

**🟠 HIGH · Payout destination is fully editable free-text (ADMIN-2 still open)**  `[known-open]`
- **Where:** `app/Filament/Pages/Payouts.php:116-118`
- **Evidence:** Both 'Pay a runner' (Payouts.php:116-118 account_number/account_holder_name TextInputs) and 'Send via Xendit' (Payouts.php:210-214) accept arbitrary typed account numbers and holder names; sendViaXendit merely pre-fills from runnerProfile in fillForm (:201-209) but leaves every field editable before calling PaymentService::createPayout (:218-223). A single finance admin (no MFA, no second approver) can redirect any runner's disbursement to an attacker-controlled GCash/bank account. Only the bulk sendSelectedViaXendit (:319-330) uses the locked saved profile.
- **Root cause:** Disbursement destination is treated as an ad-hoc form input rather than a locked attribute of the runner's verified payout profile.
- **Fix:** Disburse only to the runner's stored, KYC-verified payout method (make channel/account read-only, or require separate super_admin approval + audit when the destination differs from the saved profile). Add a maker-checker step for payouts above a threshold.

**🟡 MEDIUM · Money/pricing config levers are edited with no audit trail**  `[new]`
- **Where:** `app/Filament/Resources/SystemConfigs/Pages/EditSystemConfig.php:8-16`
- **Evidence:** EditSystemConfig is a bare EditRecord with getHeaderActions()=>[] and no AdminActivity hook. SystemConfig values are read by PricingService, ReferralService, MatchingService, RunnerPayoutController and BookingController (grep 'SystemConfig::'), i.e. commission/pricing/referral levers. No model uses spatie LogsActivity (grep for LogsActivity in app/Models returns nothing), and ErrandType per-km fare edits (EditErrandType) and PromoCode discount edits (EditPromoCode) are likewise unaudited. Only PlatformPaymentMethods.php:64 audits a config change.
- **Root cause:** Audit coverage was applied action-by-action in Filament; plain resource EditRecord pages for config models were left out, and there is no global model-change auditing to catch them.
- **Fix:** Add LogsActivity (logOnlyDirty) to SystemConfig, ErrandType and PromoCode via the 'admin' log channel, or override afterSave() in each EditRecord to AdminActivity::log the changed keys. Given SystemConfig drives commission/pricing, treat this as the priority.

**🟡 MEDIUM · Admin panel renders KYC documents via public-disk file_url (SEC-1 current status)**  `[known-open]`
- **Where:** `app/Filament/Resources/RunnerProfiles/RelationManagers/RunnerDocumentsRelationManager.php:60`
- **Evidence:** The relation manager shows KYC via ImageColumn::make('file_url') (line 60) and a view action ->url(fn ($r) => $r->file_url) (line 73), i.e. the document's public-disk URL. This matches the known-open SEC-1 note: filenames are unguessable on main but the docs are STILL on the public disk (the private-disk fix lives only on the unmerged branch feat/sec-1-kyc-private-disk).
- **Root cause:** KYC storage remains on the public filesystem disk on main; the admin UI links straight to those public URLs rather than time-limited signed URLs off a private disk.
- **Fix:** Merge the private-disk KYC work and switch the relation manager to Storage::disk('private')->temporaryUrl(...) so admin document access is authenticated and time-boxed.


### backend-arch

**🟠 HIGH · BookingController::store() is a ~475-line god-method with 5 duplicated payment branches; a parallel service impl is dead code**  `[known-open]`
- **Where:** `errandguy-api/app/Http/Controllers/Customer/BookingController.php:104`
- **Evidence:** store() spans L104-579. Payment-collection logic is repeated across five branches (saved-method L310-360, wallet L361-394, cash L395-405, gcash/maya L406-468, card L469-512), each near-identically doing Payment::create(...) + transitionTo + booking->update(['payment_status'=>...]) + a try/catch that calls failBooking() and returns the same ErrorCode::PAYMENT_GATEWAY_ERROR shape. PaymentService::processBookingPayment() (PaymentService.php:562-615) implements the same orchestration but a repo-wide grep of non-vendor PHP finds only its own definition (zero callers). Worse, the service copy has DIVERGED: it handles only cash/wallet/e-wallet and lacks the saved-method one-tap charge and the card/hosted-invoice paths the controller now has — so the two money implementations are already inconsistent, and the dead one is the more dangerous liability if ever re-wired.
- **Root cause:** Payment orchestration was written inline in the controller instead of being delegated to PaymentService; an earlier extracted version (processBookingPayment) was left behind rather than wired in or deleted, so the two have drifted silently.
- **Fix:** Consolidate the per-method collection logic into a single PaymentService method (e.g. collectForBooking(Booking, method, savedMethodId): {payment, checkoutUrl}) folding the five branches into one match; call it once from store(); then delete or repoint the unused processBookingPayment(). This shrinks store() to booking assembly + one payment call and localizes money branching to one testable place.

**🟡 MEDIUM · No BookingStatus enum: status strings hardcoded in 15+ sites that disagree with the model scopes**  `[new]`
- **Where:** `errandguy-api/app/Models/Booking.php:214`
- **Evidence:** Booking::scopeActive() is whereNotIn(['completed','cancelled']) (Booking.php:216), so 'no_runner','expired','rejected','failed' count as ACTIVE. But BookingController::index()'s 'active' bucket also excludes those four (BookingController.php:74,78), and its 'completed' bucket includes 'delivered' (L73) whereas scopeCompleted() is only where('status','completed') (Booking.php:221). BookingController::active() calls ->active() (L871) while index('active') uses the inline set — the two endpoints return different result sets for the same conceptual 'active'. The same magic arrays are re-typed inline in ~15 files (grep shows RunnerErrandController, ChatController, RunnerLocationController, PublicTripController, MatchingService, ProfileController, DashboardController, SOSController, etc.), each free to include or omit 'no_runner'/'delivered'.
- **Root cause:** Booking status has no enum or class constants (only PaymentStatus and BookingPaymentStatus enums exist), and the model scopes that should be the single source of truth are bypassed by copy-pasted string arrays.
- **Fix:** Introduce a BookingStatus enum (or const sets like Booking::ACTIVE_STATUSES / TERMINAL_STATUSES / COMPLETED_STATUSES), make the scopes use them, and replace the inline whereIn/whereNotIn arrays with the scopes/constants so 'active' and 'completed' mean exactly one thing everywhere.

**🟡 MEDIUM · booking_number generated 3 ways; store()/rebook() bypass the collision-safe helper and can 500 mid-booking**  `[new]`
- **Where:** `errandguy-api/app/Http/Controllers/Customer/BookingController.php:193`
- **Evidence:** BookingService::generateBookingNumber() (BookingService.php:25-32) loops until Booking::where('booking_number',$n)->exists() is false. But BookingController::store() (L193) and rebook() (L915) build the number inline as 'EG-'.now()->format('Ymd').'-'.strtoupper(Str::random(4)) with NO uniqueness check, and booking_number is a UNIQUE column (migration 2026_03_26_200004_create_bookings_table.php:13). A same-day collision therefore throws a QueryException on Booking::create rather than retrying — an uncaught 500 during booking creation, before payment is collected on the fixed path.
- **Root cause:** A safe generator exists in BookingService but the two hot creation paths reimplement the string inline instead of calling it, duplicating logic and dropping the collision guard.
- **Fix:** Replace the inline expressions at L193 and L915 with app(BookingService::class)->generateBookingNumber() (and generateRidePin()), so all three call sites share the collision-safe implementation.

**🟢 LOW · Haversine distance is copy-pasted verbatim in four classes**  `[new]`
- **Where:** `errandguy-api/app/Services/LocationService.php:216`
- **Evidence:** An identical private haversineDistance() with $earthRadiusKm = 6371 exists in LocationService.php:216, MatchingService.php:178, PricingService.php:229, and RunnerErrandController.php:758 — the same formula four times. RunnerErrandController.php:298-344 even reimplements a bounding-box + haversine filter that MatchingService/LocationService already own.
- **Root cause:** No shared geo helper/trait; each class grew its own copy of the distance math.
- **Fix:** Extract a single Support\\Geo::haversineKm() (or a HasHaversine trait) and have all four callers use it; ideally route the RunnerErrandController::available() proximity filter through LocationService rather than duplicating the box logic.

**🟢 LOW · Inconsistent inline fully-qualified facade/model references in store() reduce readability**  `[new]`
- **Where:** `errandguy-api/app/Http/Controllers/Customer/BookingController.php:180`
- **Evidence:** Inside store(), Log is written as \Illuminate\Support\Facades\Log::critical (L180) and again fully-qualified at L351/L459/L500, Str::uuid is \Illuminate\Support\Str::uuid (L222) though Str is imported (L36), SystemConfig is \App\Models\SystemConfig (L538,L544) and Carbon is \Carbon\Carbon (L520) though Carbon is imported (L31). The same symbols are sometimes imported and sometimes inlined within one method.
- **Root cause:** Incremental edits added FQCN references instead of use-imports, so the same class is referenced two different ways in one file.
- **Fix:** Add the missing use statements (Log, SystemConfig) and use the already-imported Str/Carbon consistently; purely cosmetic but it lowers the noise in the largest method in the codebase.


### booking-logic

**🟠 HIGH · Scheduled negotiate bookings are acceptable immediately — scheduling is defeated**  `[known-open]`
- **Where:** `errandguy-api/app/Http/Controllers/Runner/RunnerErrandController.php:292`
- **Evidence:** available() lists open negotiate offers gated ONLY on status='pending', pricing_mode='negotiate', negotiate_expires_at > now(), runner_id null (RunnerErrandController.php:292-295) — no gate on scheduled_at or on the deferred broadcast window. In store() (Customer/BookingController.php:518-548), a scheduled negotiate booking sets matchAt = scheduled_at − 15min, broadcastAt = matchAt, and negotiate_expires_at = broadcastAt + negotiate_timeout (i.e. scheduled_at − 10min) — a FUTURE timestamp from the moment of creation. So the row satisfies `negotiate_expires_at > now()` instantly and shows up in available(). accept() (RunnerErrandController.php:144-149) only checks status in ['pending','matched'] and runner_id, with no scheduled_at gate, so a runner can discover AND accept a scheduled negotiate errand hours/days before its slot. Once accepted, status flips to 'accepted' and the runner's active-errand slot is consumed (the hasActive check at accept lines 155-158 then blocks other errands). CreateBookingRequest permits negotiate+scheduled with no cross-rule forbidding it (CreateBookingRequest.php:102-104,110). The BroadcastToRunnersJob defer at BookingController.php:555-556 only delays the PUSH; it does nothing to stop the pull-based available() endpoint.
- **Root cause:** The negotiate discovery/accept path uses negotiate_expires_at as its sole time window, but for scheduled bookings that timestamp is anchored to the future slot (scheduled_at − 10min), not to 'is this offer live now'. There is no scheduled_at / broadcast-window lower bound on available() or accept().
- **Fix:** Add a lower-bound gate to available() and re-check in accept(): exclude scheduled bookings until their broadcast window opens, e.g. `->where(fn($q) => $q->where('schedule_type','!=','scheduled')->orWhere('scheduled_at','<=', now()->addMinutes(15)))`. Simpler: forbid negotiate+scheduled in CreateBookingRequest if the combination is not a product requirement.

**🟡 MEDIUM · Runner acceptance_rate metric is broken: crashes to 0 on first decline, never recovers, and skews matching**  `[new]`
- **Where:** `errandguy-api/app/Http/Controllers/Runner/RunnerErrandController.php:242`
- **Evidence:** decline() recomputes acceptance_rate as `max(0, (acceptance_rate * total_errands) / (total_errands + 1))` using total_errands — the count of COMPLETED errands — as the offer base (RunnerErrandController.php:241-243). For a new runner (total_errands = 0) the first decline yields (100*0)/1 = 0%, instantly zeroing the metric. accept() never increments acceptance_rate anywhere (RunnerErrandController.php:168-173 sets no acceptance_rate), so the value can only ever decrease and never rebuilds. This value is used as a matching tiebreaker (MatchingService.php:172-175 sorts by distance then acceptance_rate desc), is surfaced to customers (RunnerProfileResource.php:32) and in earnings (RunnerEarningsController.php:79). Net effect: a runner who declines even one offer sinks toward the bottom of match ranking and displays a wrong/0% trust score.
- **Root cause:** acceptance_rate is treated as a running ratio but there is no offers-received counter; total_errands (completed count) is misused as the denominator, and the accept side of the ratio is never recorded, so the metric is mathematically meaningless.
- **Fix:** Track offers_received and offers_accepted counters (increment offers_received on every offer/broadcast + increment both on accept, increment only offers_received on decline/timeout) and compute acceptance_rate = accepted/received. Until then, do not use acceptance_rate as a match tiebreaker and do not display it.

**🟡 MEDIUM · No automatic recovery for post-accept runner abandonment (BOOK-2 still open)**  `[known-open]`
- **Where:** `errandguy-api/app/Jobs/ExpireStaleMatchesJob.php:42`
- **Evidence:** ExpireStaleMatchesJob only re-matches rows still in status='matched' (ExpireStaleMatchesJob.php:42-47); AutoCancelBookingJob only acts on ['pending','no_runner'] (AutoCancelBookingJob.php:49); and ReapStrandedBookingsCommand only sweeps ['pending','no_runner'] and cancelled+paid orphans (ReapStrandedBookingsCommand.php:84, 110, 156-158). Once a runner ACCEPTS (status='accepted' and onward through heading_to_pickup/in_transit), no scheduled job recovers a booking whose runner then ghosts and never advances — the customer's prepaid money stays locked and the errand stalls until the customer manually cancels. There is also no runner no-show endpoint.
- **Root cause:** The lifecycle safety-net jobs are scoped to the pre-accept window only; the accepted→in_progress states have no staleness/heartbeat reaper.
- **Fix:** Add a stale-active sweep: for bookings in accepted/heading_to_pickup with no status progression past a configurable timeout, notify + re-offer or auto-cancel-with-refund, and expose a customer/ops 'runner no-show' action.

**🟡 MEDIUM · Prepaid pabili/shopping errands never reimburse the runner for goods cost (BOOK-3 still open)**  `[known-open]`
- **Where:** `errandguy-api/app/Http/Controllers/Runner/RunnerErrandController.php:675`
- **Evidence:** updateStatus captures actual_item_cost at picked_up and caps it at shopping_budget (RunnerErrandController.php:394-403), but handleCompletion computes settlement purely from runner_payout / (total_amount − runner_payout) and never references actual_item_cost or shopping_budget (RunnerErrandController.php:645-688). For a WALLET/ONLINE pabili the customer prepaid only total_amount (fare), not the goods cost, so a runner who fronts the goods is credited only their delivery payout and is never made whole for the items purchased. Only the cash path incidentally works (runner collects goods+fare in person).
- **Root cause:** Goods-cost reconciliation is not wired into settlement; actual_item_cost is recorded for display but has no financial effect on prepaid bookings.
- **Fix:** For prepaid shopping errands, either collect an authorized goods-cost hold at booking (up to shopping_budget) and add reconciled actual_item_cost to the runner's payout at completion, or restrict pabili/shopping to cash until the goods-cost settlement path exists.

**🟢 LOW · Matching radius and ranking use straight-line Haversine, not routed distance (PRICE-1 still open)**  `[known-open]`
- **Where:** `errandguy-api/app/Services/MatchingService.php:178`
- **Evidence:** getEligibleRunners filters eligibility with `distance > radiusKm` and ranks nearest-first, both using haversineDistance() (MatchingService.php:147-175, 178-192) — straight-line geometry. Across rivers, one-way systems, or expressway-only corridors common in PH metros, the nearest straight-line runner can be far by road, so the 'best' assignment and the enforced radius diverge from real drive distance/ETA. Confirmed unchanged.
- **Root cause:** No routing/ETA provider integration in the matching path; geometric distance is the only signal.
- **Fix:** Introduce a routed-distance/ETA lookup (or a road-network factor) for the final ranking of the top-N candidates already bounded by the Haversine prefilter, so only the small candidate set incurs the routing cost.

**🟢 LOW · CheckRideDurationJob loads all in-transit rides unbounded**  `[new]`
- **Where:** `errandguy-api/app/Jobs/CheckRideDurationJob.php:26`
- **Evidence:** The overdue-ride monitor does `Booking::where(is_transportation)->where(status,'in_transit')->whereNotNull(picked_up_at)->where(sos_triggered,false)->get()` with no limit/chunk (CheckRideDurationJob.php:26-31), then iterates in PHP. Every other sweep in the codebase caps its set (ExpireStaleMatchesJob.php:47 limit(100), available() limit(100), reaper chunk(100)); this one does not, so it scales with concurrent-ride volume in a scheduled per-minute job.
- **Root cause:** Missing pagination/limit on a scheduled full-table scan of active rides.
- **Fix:** Chunk the query (chunkById(100)) or add a bounded limit + cursor consistent with the other sweeps.

**🟢 LOW · accept() lets any runner claim a pre-match 'pending' fixed booking (no offer binding)**  `[new]`
- **Where:** `errandguy-api/app/Http/Controllers/Runner/RunnerErrandController.php:144`
- **Evidence:** accept() admits status in ['pending','matched'] and only blocks when runner_id is set to someone else (RunnerErrandController.php:144-149). A fixed booking in 'pending' (before MatchRunnerJob assigns, or after ExpireStaleMatches resets it) has runner_id=null, so ANY approved/online runner who has the booking id can accept it, bypassing the distance/ranking dispatch. In practice a fixed booking is not exposed via available() (which returns negotiate only, line 293) and IncomingRequest is sent only to the matched runner, so exploitation requires knowing the id — but the lifecycle relies on obscurity rather than an offer-binding check for fixed mode.
- **Root cause:** Fixed-mode acceptance is not bound to the runner the booking was actually offered/matched to; the same permissive gate is shared with the intentionally open negotiate broadcast path.
- **Fix:** For pricing_mode='fixed', require booking.runner_id === accepting user (i.e. only the matched runner may accept); keep the open first-come acceptance only for negotiate broadcasts.


### mobile-arch

**🟠 HIGH · God-component screens: 1800-2875 lines with 20-31 useState each**  `[known-open]`
- **Where:** `errandguy-mobile/src/app/(customer)/tracking/[id].tsx:180`
- **Evidence:** VERIFIED in current code: tracking/[id].tsx is 2875 lines with a single default export TrackingScreen (line 180) holding 25 useState / 17 useEffect / 13 useRef. book/details.tsx is 2563 lines as ONE component (only PulseMarker at line 72 and CenterPin at line 133 are extracted; TaskDetailsScreen at line 197 holds 31 useState). (runner)/errand/[id].tsx is 1788 lines / 22 useState / 16 useRef. Only 2 React.memo usages exist across all of src/components (ChatImage.tsx, RecentErrandItem.tsx). Line/hook counts re-run and confirmed.
- **Root cause:** Feature accretion into single route components without extracting sub-sections (map pane, bottom sheet, contact card, receipt) into memoized children. Every piece of local state lives in one closure, so any state change re-runs the entire render tree and the files are near-impossible to reason about or unit test.
- **Fix:** Decompose each screen into presentational children (e.g. <TrackingMap>, <RunnerCard>, <StatusSheet>) that take narrow props and are wrapped in React.memo. Lift co-located concerns into hooks. This shrinks the re-render surface and makes the money/tracking logic reviewable.

**🟠 HIGH · book/details re-renders the whole 2360-line screen on every keystroke**  `[new]`
- **Where:** `errandguy-mobile/src/app/(customer)/book/details.tsx:199`
- **Evidence:** VERIFIED in current code: line 199 subscribes with NO selector: `const { draftBooking, updateDraft, setStep } = useBookingStore();`. TextInputs write straight to the store on each keystroke - `onChangeText={(v) => updateDraft({ special_instructions: v })}` (line 1760), description (1708), and contact fields (1856/1868/1928/1940) among 19 updateDraft call sites. updateDraft (bookingStore.ts:142) does synchronous `set((state) => ({ draftBooking: { ...state.draftBooking, ...data } }))`, changing the subscribed slice, so the entire ~2360-line TaskDetailsScreen (map panes, sheet, all sections) re-renders per character. A 250ms PERSIST_DEBOUNCE_MS exists but only debounces persistence, not the in-memory set().
- **Root cause:** Draft text is stored in the global zustand store rather than local component state, combined with a non-selector whole-store subscription. Debounced persistence exists (PERSIST_DEBOUNCE_MS=250) but the in-memory set() runs synchronously per keystroke.
- **Fix:** Hold in-progress text in local useState (or an uncontrolled ref) and flush to updateDraft onBlur / on step-advance; or debounce the store write. At minimum use per-field selectors so unrelated store changes don't re-render. On mid-tier Android the current form is a measurable typing-jank source.

**🟡 MEDIUM · Untyped service layer + 145 `as any`; money/estimate path typed `any`**  `[new]`
- **Where:** `errandguy-mobile/src/services/booking.service.ts:38`
- **Evidence:** 145 `as any` across src (grep). Most service methods return implicit AxiosResponse<any> (getBookings:77, getBooking:132, getActiveBooking:195 are untyped; only cancelPreview/shareTrip/retryMatch carry generics). The fare estimate — the sole gate on the Confirm CTA — is `any` end to end: `estimateStash: {result: any}` (line 38), `.then((res:any)=>...)` (line 58), `getCachedEstimate(...): any|null` (line 218), consumed as `const [estimate,setEstimate]=useState<any|null>(null)` in details.tsx:250. runner.service.ts alone has 16 `as any`, mostly `{ silent:true } as any` axios-config casts.
- **Root cause:** The api wrapper's ExtraConfig extra fields (silent/cacheTtlMs/idempotencyKey) aren't part of Axios's public config type, so every call site casts the options object to `any`, and no response DTOs were ever declared. The casts silence the config-type error but also erase the response body type.
- **Fix:** Type the api wrapper to accept ExtraConfig (overload api.get/post) so `{ silent:true }` needs no cast, and declare response DTOs (Booking, EstimateResult, etc.) as api.get<T> generics. Prioritize the estimate/booking/payment DTOs since those are the money surface where a silent shape drift is most costly.

**🟡 MEDIUM · book/details diverges from the app's NativeWind convention (inline styles), amplifying re-render cost**  `[new]`
- **Where:** `errandguy-mobile/src/app/(customer)/book/details.tsx:1`
- **Evidence:** book/details.tsx uses `style={...}` 121 times and `className=` only 2 times, with a single StyleSheet.create — so ~120 style objects are inline literals allocated every render. The rest of the app is NativeWind: tracking/[id].tsx has 119 className vs 82 style, errand/[id].tsx 85 className vs 24 style. One of the two most central customer screens is built in the opposite paradigm.
- **Root cause:** Screen authored before/against the NativeWind convention and never migrated. Inline object literals also defeat referential-equality skips in child components and, combined with finding #2, mean every keystroke both re-renders and re-allocates ~120 style objects.
- **Fix:** Migrate to className (or at minimum hoist static style objects into a StyleSheet.create / module constants so they aren't re-allocated per render). Aligning the paradigm also removes a class of the NativeWind function-style gotcha documented in project memory.

**🟢 LOW · useQuery.mutate can be silently clobbered by focus/reconnect revalidation**  `[new]`
- **Where:** `errandguy-mobile/src/hooks/useQuery.ts:260`
- **Evidence:** mutate() (lines 260–273) sets data and writes the cache with fetchedAt=Date.now() but does NOT update lastFetchedRef.current or updatedAt. revalidateIfStale() (lines 223–229) gates on `Date.now() - lastFetchedRef.current > staleTime`. If the held value was already older than staleTime when the optimistic mutate ran, the next AppState 'active' / reconnect event immediately revalidates and overwrites the optimistic value with the server copy (which may not yet reflect the mutation).
- **Root cause:** mutate updates React state + AsyncStorage but not the two refs the background-revalidation gate reads, so the optimistic write is invisible to the freshness check.
- **Fix:** In mutate, set lastFetchedRef.current = now and setUpdatedAt(now) alongside the cache write, so an optimistic update resets the staleness clock the same way a real fetch does.

**🟢 LOW · useChat pagination cursor/hasMore not reset when bookingId changes in place**  `[new]`
- **Where:** `errandguy-mobile/src/hooks/useChat.ts:74`
- **Evidence:** Lines 74–77 comment 'Reset whenever the bookingId switches so a new conversation starts at the head', but hasMore/loadingOlder state and cursorRef have no effect that resets them on bookingId change — only route remount clears them. If the hook's host component is reused across a bookingId prop change (not a full route remount), loadOlder() would page the previous conversation's cursor into the new thread.
- **Root cause:** Stated invariant relies on expo-router remounting the [bookingId] route; there is no explicit reset effect keyed on bookingId to enforce it.
- **Fix:** Add a useEffect([bookingId]) that resets cursorRef.current=null, setHasMore(false), setLoadingOlder(false) to make the invariant robust regardless of how the hook is mounted.

**🟢 LOW · 15 whole-store (selector-less) subscriptions across screens**  `[new]`
- **Where:** `errandguy-mobile/src/app/(runner)/(tabs)/index.tsx:196`
- **Evidence:** 15 `= useXStore();` no-selector subscriptions (grep). Runner home (index.tsx:196), errand/[id].tsx:162, profile.tsx:199, payout/index.tsx:67, and all book/* screens subscribe to entire stores. Most are small or actions-only today, but runnerStore/bookingStore consumers re-render on any store field change.
- **Root cause:** Convenience destructuring of the whole store instead of per-field selectors (the pattern useChat.ts:38–71 correctly avoids after a documented re-render-storm fix).
- **Fix:** Adopt per-field selectors as the standard on hot screens (runner home, tracking, book flow), matching the useChat precedent; leave actions-only reads as-is since action refs are stable.


### mobile-ux

**🟠 HIGH · Font scaling globally disabled — app ignores OS Dynamic Type / display-size (WCAG 1.4.4 failure)**  `[new]`
- **Where:** `errandguy-mobile/src/app/_layout.tsx:66-74`
- **Evidence:** _layout.tsx sets Text.defaultProps.allowFontScaling = false, TextInput.defaultProps.allowFontScaling = false, and TextInput.defaultProps.maxFontSizeMultiplier = 1 at module scope before any screen mounts (comment lines 58-64: 'Lock font scaling globally so the app renders at the same physical size ... regardless of the OS-level Display size / Font size accessibility settings'), cascading through the whole tree. Confirmed still present now. Because allowFontScaling defaults to false, the Dynamic Type accommodations are dead code: the CHROME_MAX_FONT_SCALE=1.3 caps in Typography.tsx:13 (used at :54/:106/:235), Button.tsx:230, JourneyBeads.tsx:298/313, OnboardingSlide.tsx:107, ToastProvider.tsx:118/132, and the ~24 maxFontSizeMultiplier props in tracking/[id].tsx all have no effect. The explicit 'Headings/body/data ... are deliberately NOT capped — real content and should scale freely' contract at Typography.tsx:8-12 is violated: SectionHeader title/subtitle (Typography.tsx:85-91) inherit the disabled default and never scale. mScaleFor (responsive.ts:69) scales by screen WIDTH only and there is no PixelRatio.getFontScale() code path anywhere, so no fallback exists. A low-vision user who raises their system font size sees zero change anywhere in the app.
- **Root cause:** A legitimate cross-platform consistency complaint (Android with a large display setting rendered labels ~1.3x bigger than iOS) was fixed with the bluntest instrument — disabling text scaling entirely — instead of capping the multiplier or normalizing only the Android over-scale. The remedy throws out all Dynamic Type support to solve a consistency nit.
- **Fix:** Leave allowFontScaling=true and instead set a global maxFontSizeMultiplier (~1.3) on Text/TextInput defaultProps so text still responds to the OS font-size preference up to a bounded cap (fixed-height chrome already assumes 1.3). If the real problem is only Android over-scaling, normalize per-platform using PixelRatio.getFontScale() rather than pinning to 1. Then the existing per-component caps and 'scales freely' content become meaningful again.

**🟢 LOW · Reduce-motion preference ignored by 8 modal/entrance components despite existing infrastructure**  `[new]`
- **Where:** `errandguy-mobile/src/components/ui/ConfirmModal.tsx:71-74`
- **Evidence:** The app has full reduce-motion infra (useReducedMotion + preferencesStore.reduceMotionOverride) and honors it in ~19 places (Button.tsx, SlideToConfirm.tsx, IncomingRequestModal.tsx pulse, HidingTabBar.tsx, login.tsx CheckboxSquare). But 8 moti-using components animate scale/translate entrances with no reduce-motion gate: ConfirmModal.tsx (MotiView from scale:0.92/translateY:12, lines 71-74), FloatingModal.tsx:43-44 (scale:0.96 spring-in), LogoutSplash.tsx:43-45 (translateY entrance), ImagePickerModal.tsx, ReceiptCaptureModal.tsx, PhotoProofModal.tsx, CompletionModal.tsx, RateCustomerModal.tsx. A user with vestibular sensitivity who enabled Reduce Motion still gets scale/slide entrances on confirmation dialogs and the runner capture modals.
- **Root cause:** Reduce-motion gating was applied component-by-component as screens were built; these later/less-central modals were not retrofitted with the same useReducedMotion check.
- **Fix:** In each, read useReducedMotion() (or preferencesStore) and collapse the from/animate deltas to a plain fade (or duration 0) when true — the exact pattern already used in login.tsx CheckboxSquare and IncomingRequestModal.tsx pulseAnim.

**🟢 LOW · Icon-only bottom tab bar with labels hidden raises recognition cost for sighted users**  `[new]`
- **Where:** `errandguy-mobile/src/app/(customer)/(tabs)/_layout.tsx:67`
- **Evidence:** tabBarShowLabel: false (customer _layout.tsx:67; same on runner) and TabBarItem.tsx renders an Ionicons glyph only, no text label ('No label and no active dot — the outline→solid swap is the whole affordance'). Screen readers are covered (react-navigation derives accessibility labels from each Tabs.Screen `title`, plus the explicit tabBarAccessibilityLabel for the unread Alerts badge at _layout.tsx:116-119), so this is purely a VISUAL-label gap. First-time, low-literacy, or occasional users must recognize the list/bell/person glyphs unaided — a recognition-over-recall cost the rest of the app otherwise avoids.
- **Root cause:** Deliberate 'clean & airy' redesign choice to strip tab labels for minimalism, trading visual affordance for aesthetic density.
- **Fix:** Show text labels at least for the focused tab, or on first launch/for N sessions, or as a persistent small caption on phones (tablets have ample room). Low effort — react-navigation supports per-tab tabBarLabel and the titles already exist.

**🟢 LOW · Auto-hiding tab bar hides primary nav on scroll and leaves off-screen tabs in the accessibility tree**  `[new]`
- **Where:** `errandguy-mobile/src/components/ui/HidingTabBar.tsx:50-63`
- **Evidence:** HidingTabBar translates the whole BottomTabBar off-screen on scroll-down (transform translateY = progress * height, line 51) but never sets importantForAccessibility="no-hide-descendants" / accessibilityElementsHidden while hidden, so a screen-reader user swiping through page content can still land on the now-invisible tab buttons. It also only fades opacity to 0.75 at progress=1 (line 53), relying on the translate alone to remove it. Separately, hiding the primary navigation on scroll is a discoverability cost for all users (mitigated: it returns on scroll-up and freezes under Reduce Motion via the reduceMotion branch at 40-48).
- **Root cause:** The hide animation manages visual position and motion but not the accessibility/interaction state of the hidden subtree.
- **Fix:** When hidden, set importantForAccessibility="no-hide-descendants" (Android) + accessibilityElementsHidden (iOS) and pointerEvents="none" on the Animated.View so VoiceOver/TalkBack and touches skip the off-screen bar; drive both off the same `hidden` store value.


### money

**🟠 HIGH · Online booking is dispatched to runners before payment settles; a runner can complete an unpaid online errand and is credited nothing**  `[new]`
- **Where:** `errandguy-api/app/Http/Controllers/Customer/BookingController.php:525`
- **Evidence:** CONFIRMED in current code. For a fixed online (gcash/maya/card) booking, store() sets payment_status='pending' (BookingController.php:455 for e-wallet, :496 for card hosted invoice) and returns a checkout_url for the customer to pay LATER, but immediately runs MatchRunnerJob::dispatchSync($booking->id) (BookingController.php:535) while payment_status is still 'pending'. There is no payment gate in matching (grep of MatchRunnerJob.php/MatchingService.php for payment_status/'paid' returns nothing). accept() (Runner/RunnerErrandController.php:126-176) enforces only runner online/approved + atomic claim — NO payment_status check. updateStatus->handleCompletion (Runner/RunnerErrandController.php:351-472, 621-728) also has NO payment gate: the completed transition (L459-471) calls handleCompletion which credits the runner only if payment_status==='paid' (L649) or method==='cash' (L662); L689 is an explicit fall-through '// else: unsettled online payment — nothing was collected, credit nothing.' So a runner can accept and mark an online booking 'completed' before/without the customer paying: handleCompletion credits P0, and markPaymentCompleted is skipped ($collected=false, L725). The late-settlement backfill (BookingSettlementService) only fires if the charge later settles via webhook; if the customer abandons the hosted-invoice checkout, the runner performed the errand for free and the platform collected nothing.
- **Root cause:** Matching/acceptance/completion are not gated on payment_status for gateway bookings. Online payment is collected asynchronously (webhook) but the errand is allowed to proceed all the way to completion regardless of whether it was ever paid. No server-side rule 'an online booking must be paid before it can be accepted (or before it can be completed)' exists.
- **Fix:** Gate the runner-facing path on payment for online bookings: (a) do not enter matching until payment_status='paid' for method in {gcash,maya,card} — dispatch MatchRunnerJob from the settlement/webhook path instead of from store(); or (b) block updateStatus from advancing an online booking past 'accepted' while payment_status !== 'paid', returning 422 'awaiting customer payment'. Cash/wallet keep the current immediate flow.

**🟡 MEDIUM · A gateway tip collected for an already-tipped errand is marked completed with only a CRITICAL log — the customer's real gateway charge is never auto-refunded**  `[new]`
- **Where:** `errandguy-api/app/Services/WalletService.php:524`
- **Evidence:** completeGatewayTip's duplicate guard (L519-539): when booking.tip_amount>0 or a runner 'tip' row already exists, it does NOT credit the runner again (correct) but sets the tip_payment row status='completed' with failure_reason 'Duplicate tip payment — refund required.' and only Log::critical(...'MANUAL REFUND REQUIRED'). The customer was really charged via Xendit for this second tip and no automated reversal is issued — recovery depends entirely on a human reading the log.
- **Root cause:** The path collects money at the gateway before it can verify the tip is still needed, and on the losing side of the race there is no programmatic refund — only an ops alarm.
- **Fix:** On the duplicate branch, initiate an automatic gateway refund of the collected tip (reuse the Xendit /refunds call keyed on the tip_payment id for idempotency) instead of relying on a manual refund, or hold the charge as 'pending_refund' and have a scheduled command sweep it.

**🟡 MEDIUM · Cancelling an online booking while its charge is still in-flight records a zero cancellation fee, so the late-settlement auto-refund returns the FULL amount — fee is never collected**  `[new]`
- **Where:** `errandguy-api/app/Http/Controllers/Customer/BookingController.php:674`
- **Evidence:** cancel() sets $collected = payment_status==='paid' (L674) and $effectiveFee = $collected ? min(policy fee, total) : 0.0 (L675-677). For a gateway booking cancelled while payment_status is 'pending'/'processing', cancellation_fee is stored as 0. When the charge later settles, BookingSettlementService::refundChargeOnCancelledBooking computes $fee = (float)$locked->cancellation_fee (=0) and refunds $refundable = total_amount − 0 = the full amount (BookingSettlementService.php:80-88). The cancellation fee the policy would otherwise charge is silently forgiven for any online booking cancelled before its charge settles.
- **Root cause:** Fee applicability is decided at cancel time off payment_status, but for async gateway charges the money genuinely arrives later; the settlement path then honours the zero fee recorded earlier instead of re-deriving the fee that policy intended.
- **Fix:** When auto-refunding a late-settling charge on a cancelled booking, re-evaluate the cancellation fee against the now-collected amount (or persist the intended policy fee at cancel time and apply it here capped at the settled amount) so an online cancel-before-settle is charged the same fee a paid cancel would be.

**🟢 LOW · Pull-reconciler checks the payment_request's requested amount, not the captured amount, so it cannot catch an under-capture the webhook would reject**  `[new]`
- **Where:** `errandguy-api/app/Services/PaymentService.php:689`
- **Evidence:** reconcileBookingPayment reads $settled = (float)($pr['amount'] ?? 0) from the payment_request object (L689) and only refuses when that is below charged. $pr['amount'] is the amount we REQUESTED, so it always equals $locked->amount and the short-settle guard here can never trigger. The webhook path instead uses $data['paid_amount'] ?? $data['amount'] (settledInFull, XenditWebhookController.php:588), which reflects what was actually captured. In dev/test or on webhook lag the pull path 'always wins' and would mark a genuinely under-captured charge as fully paid.
- **Root cause:** Inconsistent settled-amount source between the two settlement paths — request amount vs captured paid_amount.
- **Fix:** In reconcileBookingPayment, read the captured amount from the payment_request's payment/settlement sub-object (or the linked payment) rather than the top-level requested amount, mirroring settledInFull.

**🟢 LOW · PRICE-2 still open: runner receives no share of the cancellation fee and there is no runner no-show/cancellation endpoint**  `[known-open]`
- **Where:** `errandguy-api/app/Http/Controllers/Customer/BookingController.php:701`
- **Evidence:** On cancel the kept fee is described as 'platform/runner compensation' (L698-701) but no runner WalletTransaction is ever written — the entire effectiveFee stays with the platform (only the customer refund of total−fee is booked). Grep of the cancel/settlement paths shows runner credits only for 'earning'/'commission'/'tip', never a cancellation-fee share, and there is no runner-initiated no-show endpoint. Status: CONFIRMED still open exactly as listed in known-open.
- **Root cause:** Cancellation-fee split policy and a runner no-show flow were never implemented.
- **Fix:** Split the recorded cancellation_fee: credit the assigned runner their agreed share as an 'earning'-type transaction inside the same cancel transaction, and add a runner no-show/cancellation endpoint with its own settlement.

**🟢 LOW · Over-settlement (customer overpays the invoice) is logged but the excess is never refunded**  `[known-open]`
- **Where:** `errandguy-api/app/Http/Controllers/Payment/XenditWebhookController.php:605`
- **Evidence:** settledInFull (L605-612) and completeTopUp (WalletService.php:158-165) both Log::critical on an over-settlement but then proceed to mark the charge paid / credit only the RECORDED amount; the surplus the customer actually paid is retained with no automated refund of the difference.
- **Root cause:** Over-settlement is treated as 'not a money-safety risk to complete' and left for manual reconciliation, but the customer's overpayment is real money held indefinitely.
- **Fix:** On a confirmed over-settlement, credit the difference to the customer's wallet (top-up/booking) as a distinct idempotent transaction, or queue an automatic partial gateway refund of the surplus, rather than only logging.


### privacy

**🟠 HIGH · Trusted-contact phone number written to logs in cleartext**  `[regression]`
- **Where:** `errandguy-api/app/Listeners/SendSafetyAlertNotification.php:50`
- **Evidence:** notifyTrustedContacts() does Log::info("Safety SMS to {$contact->phone}: [{$title}] {$body}") for every trusted contact on a duration/route-deviation alert — a third party's mobile number (non-user PII) plus the alert body land in the daily log channel. VERIFIED against current code: line 50 unchanged. The sibling code path NotifySosContactsJob::notifySMSContact (lines 90-93) was hardened to log ONLY booking_id + contact_id and explicitly documents 'Do NOT log the live-link token or the contact's phone' — so this listener is a regressed/inconsistent instance of the same log-scrub fix.
- **Root cause:** The safety-alert listener predates the log-scrub pass and was not updated; there is no global Monolog PII processor (config/logging.php registers only PsrLogMessageProcessor), so raw interpolation persists to disk.
- **Fix:** Mirror NotifySosContactsJob: log only non-sensitive breadcrumbs (booking_id, contact_id, alert type). Remove {$contact->phone} and the message body from the log line. Consider a Monolog processor that redacts phone/email patterns as defense-in-depth.

**🟠 HIGH · SOS / trip-share token leaked into logs via full-URL logging**  `[new]`
- **Where:** `errandguy-api/app/Http/Middleware/LogApiRequests.php:76`
- **Evidence:** logData['url'] = $request->fullUrl() (line 72). VERIFIED: SKIP_PATTERNS (lines 14-17) contains only 'runner/location' and 'chat/unread-count' — 'trip/' is absent. The public unauthenticated tracking route GET /trip/{token} exists (routes/api.php:391, PublicTripController, throttle:60,1). The suppression at line 66 only drops fast-success info lines; a 404 on an expired/invalid link is status>=400 (isError) and therefore ALWAYS logs the full URL including the token via Log::warning (line 88) — in production too. That token is the unauthenticated key to a live victim's location and runner details. NotifySosContactsJob (lines 87-89) explicitly refuses to log this exact token; this cross-cutting logger silently defeats that.
- **Root cause:** URL-based logging captures path tokens indiscriminately; the token-secrecy design was applied at the emit site but not at the request logger.
- **Fix:** Add 'trip/' to SKIP_PATTERNS, or log $request->route()?->uri() (the '{token}' template) instead of fullUrl for public token routes, redacting the resolved token segment.

**🟠 HIGH · Right-to-erasure is incomplete — chat messages and chat images survive account deletion**  `[partially-fixed]`
- **Where:** `errandguy-api/app/Http/Controllers/Customer/ProfileController.php:174`
- **Evidence:** VERIFIED: the deleteAccount() erasure transaction (lines 174-229) redacts runnerProfile docs/bank, savedAddresses, trustedContacts, own-booking contact fields, BookingStop contacts, tokens and device tokens — but never the messages table. messages.content and messages.image_url are free-text/user-uploaded (migration 2026_03_26_200010_create_messages_table.php:15-16, both text nullable) and routinely hold addresses, names, phones and photos. The sender_id FK references users WITHOUT cascadeOnDelete (messages migration line 22 is a plain references()/on(), only booking_id cascades at line 21), and User.php defines no messages() relation. So a soft delete leaves the deleted user's typed PII and uploaded chat images fully readable, still linked to the anonymized user_id; even a hard delete would not clear them.
- **Root cause:** PRIV-1 enumerated child PII tables manually and omitted messages; there is no cascade and no message redaction step.
- **Fix:** In the erasure transaction, redact messages where sender_id = user (content => null, image_url => null) and collect message image_url files into $filesToDelete for post-commit removal like avatars/KYC docs; or tombstone the rows ('[deleted]').

**🟠 HIGH · In-app privacy notice omits every mandatory DPA disclosure; consent version drifts from displayed copy**  `[new]`
- **Where:** `errandguy-mobile/src/components/auth/LegalModal.tsx:48`
- **Evidence:** VERIFIED: the privacy CONTENT (lines 48-64) is three short placeholder paragraphs (docblock line 22 calls it 'placeholder copy'). Missing all NPC/RA 10173 elements: personal-information-controller identity + registered address, DPO contact, enumerated third-party processors/recipients (payment gateway, Firebase/FCM, Expo push, Gmail API transport, DomPDF, Forge hosting), cross-border transfer notice (FCM/Expo route through US), retention periods, legal basis, and the right to lodge a complaint with the NPC. Line 57 claims 'We never sell your personal information or share it with third parties for marketing' while the platform does disclose booking PII to FCM/Expo/payment processors. Consent-version integrity is broken: constants/legal.ts:7 sets PRIVACY_POLICY_VERSION = '2026-08-01' (the value persisted to users.privacy_policy_version) yet the modal footer renders 'Last updated: January 2026' (LegalModal.tsx:116) — the recorded consent version points at copy dated differently.
- **Root cause:** Legal copy is acknowledged placeholder never replaced with a lawyer-reviewed RA 10173 privacy notice; the version constant and the displayed date are maintained separately.
- **Fix:** Replace with a compliant privacy notice enumerating controller/DPO/processors/cross-border/retention/rights/NPC route; render the last-updated date from PRIVACY_POLICY_VERSION so consent version and displayed policy cannot drift.

**🟡 MEDIUM · No data-subject right-to-access / data-portability (DSAR) mechanism**  `[new]`
- **Where:** `errandguy-api/app/Http/Controllers/Export/ExportController.php:12`
- **Evidence:** ExportController exposes only earningsPdf (runner earnings) and receiptPdf (single payment). There is no endpoint that returns a data subject's full personal data (profile, bookings, addresses, trusted contacts, messages, reviews) for access or portability. The privacy notice (LegalModal.tsx:60-62) offers only profile update + deletion. RA 10173 §16 grants the rights to access and to data portability, which are unimplemented.
- **Root cause:** Erasure (PRIV-1) was built but the parallel access/portability right was not; no self-service export or support-driven DSAR flow exists.
- **Fix:** Add an authenticated self-service export (GET /profile/data-export) assembling the caller's own records into a downloadable JSON/PDF, and document a DSAR turnaround in the privacy notice.

**🟡 MEDIUM · Third-party PII (trusted contacts, booking pickup/dropoff contacts) collected with no notice, consent capture, or subject-rights path**  `[new]`
- **Where:** `errandguy-api/app/Http/Requests/TrustedContactRequest.php:14`
- **Evidence:** TrustedContactRequest validates a third person's name + PH mobile (lines 17-18) and TrustedContactController stores up to 5 per user; those contacts are then targeted for SMS (NotifySosContactsJob.php:39-44, SendSafetyAlertNotification.php:46-52). Booking pickup_contact_name/phone and BookingStop contact_name/phone are the same pattern. These are identifiable non-users with no notice that their data is stored/processed, no lawful-basis capture, and no mechanism to access or request erasure of their own data. The privacy notice never discloses that contacts entered about other people will be stored or messaged.
- **Root cause:** Feature design treats contact details as the user's own data; DPA transparency/lawful-basis obligations toward the third-party data subject were not addressed.
- **Fix:** Disclose third-party-contact storage + SMS in the privacy notice, add a consent affirmation that the user has the contact's permission, and provide a documented removal channel for a contact who objects.

**🟡 MEDIUM · Registration writes raw phone + email to logs**  `[new]`
- **Where:** `errandguy-api/app/Http/Controllers/Auth/RegisterController.php:20`
- **Evidence:** register() calls Log::info('Registration attempt', ['phone' => ..., 'email' => ..., 'ip' => ...]) at line 20-25 and again logs user_id + ip at 62-66. Unlike the LogApiRequests info-suppression in prod (LogApiRequests.php:66), these are direct application log calls that fire in every environment. With APP_DEBUG/daily logs in prod (per project notes) this persists every registrant's phone, email and IP to disk with no scrubbing processor (config/logging.php:94,105 only add PsrLogMessageProcessor).
- **Root cause:** Debug-level identity logging left in the auth path; no global PII redaction processor.
- **Fix:** Drop phone/email from the log context (keep user_id + request_id + ip only), or hash/mask them; add a Monolog processor that redacts phone/email fields platform-wide.

**🟢 LOW · No enforced retention limit for PII on non-deleted accounts**  `[new]`
- **Where:** `errandguy-api/database/migrations/2026_03_26_200010_create_messages_table.php:11`
- **Evidence:** Hot/volatile tables are pruned (runner_locations + dedup records per project notes), but bookings retain pickup/dropoff addresses and (for non-deleting users) contact PII, and messages retain content/images indefinitely with no scheduled purge for long-closed bookings. There is no retention schedule beyond the financial-record justification cited in ProfileController.php:154-156. DPA storage-limitation requires PII be kept only as long as necessary.
- **Root cause:** Retention was reasoned about only in the erasure path for account deletion, not as a standing lifecycle policy for closed bookings/messages.
- **Fix:** Define a retention window (e.g. redact message content + booking contact fields on bookings closed > N months while keeping the financial columns) and enforce it via a scheduled command like the existing reap/reconcile jobs.


### product

**🟠 HIGH · First-run users hit a Location + Contacts OS-permission gauntlet before signing up or picking a role**  `[known-open]`
- **Where:** `errandguy-mobile/src/app/(auth)/welcome.tsx`
- **Evidence:** welcome.tsx:88 and :97 route Skip/Get-Started to '/(auth)/permissions'; permissions.tsx:50 onNext pushes '/(auth)/contacts-permission'; contacts-permission.tsx:62 onNext pushes '/(auth)/login' — so both primers sit BEFORE login/register. PermissionPrimer.handleAllow (PermissionPrimer.tsx:194) fires the OS dialog on the Allow tap for an unauthenticated first-run user. Role is only chosen post-auth (role-select.tsx:53-66 updateProfile({role})), so the contacts pitch 'Add recipients faster / Set up trusted contacts for safety' (contacts-permission.tsx:20-24) — purely customer features — is shown to every prospective user including future runners, with zero relevance context.
- **Root cause:** Permission primers were placed in the pre-auth onboarding chain (welcome->permissions->contacts->login) instead of being deferred to the in-context moment they're needed (location at first booking/map, contacts at recipient/trusted-contact entry). No role is known at this point, so copy can't be tailored, and a contacts prompt from an app with no account invites App-Store review scrutiny.
- **Fix:** Move the location and contacts primers out of the pre-auth chain: point welcome's Skip/Next straight at login/register, and trigger each primer just-in-time (location when the booking map/tracking first mounts, contacts when the user opens recipient or trusted-contacts pickers). This lifts grant rates, tailors the ask to the chosen role, and avoids an App-Store-scrutinized contacts prompt from an app with no account yet.

**🟡 MEDIUM · "Choose your role — you can switch anytime" is a broken promise; no role-switch UI exists anywhere**  `[new]`
- **Where:** `errandguy-mobile/src/app/(auth)/role-select.tsx`
- **Evidence:** role-select.tsx:109 renders 'Choose your role. You can switch anytime.' but a grep of src/ shows updateProfile({ role }) is called ONLY in role-select.tsx:58. The customer profile menus (customer/(tabs)/profile.tsx:165-224: Account/Payment/Earn/Support) contain no switch entry, and the runner profile menus (runner/(tabs)/profile.tsx:315-353) likewise have none. A user who taps the wrong role, or a runner who wants to book as a customer, has no in-app path back — the only recovery is Delete Account.
- **Root cause:** Role is treated as a one-time signup selection; the profile hubs never surfaced a switch affordance even though the backend userService.updateProfile({ role }) supports it (already used at signup).
- **Fix:** Either add a 'Switch to Runner/Customer' row in both profile hubs (calling the same updateProfile({role}) + re-routing via the group layouts, which already self-correct by role), or remove the 'switch anytime' copy from role-select so the promise matches the product.

**🟡 MEDIUM · Hard login wall — no guest/browse mode, and the only pre-signup content is a 3-slide carousel**  `[new]`
- **Where:** `errandguy-mobile/src/app/index.tsx`
- **Evidence:** index.tsx:53-58 and _layout.tsx:243-249 redirect every unauthenticated user to welcome/login; the customer group layout (customer/_layout.tsx:27-35) and runner layout bounce unauthenticated users out entirely. The whole errand catalog + indicative pricing (configService.getErrandTypes / base_fee shown on book/type.tsx:338) lives behind auth. A prospective user cannot see what services exist, coverage, or 'from ₱X' pricing before committing to registration.
- **Root cause:** Auth is enforced at the router root with no read-only/guest branch; onboarding communicates value only via the 3 static welcome slides, which are never shown again after first launch.
- **Fix:** Add a lightweight guest/browse entry (e.g. a read-only errand-type + pricing preview reachable from welcome without an account) that funnels into register at the point of booking. This is a direct top-of-funnel conversion lever for a marketplace where the value prop is otherwise invisible pre-signup.

**🟡 MEDIUM · Registration funnel is long and rigid — BOTH phone and email are mandatory even though login accepts either**  `[new]`
- **Where:** `errandguy-mobile/src/app/(auth)/register.tsx`
- **Evidence:** register.tsx:447 makes phone required ('Phone number is required') and :482 makes email required ('Email is required'), plus a 4-rule strong password (:520-527) and confirm-password. login.tsx:38-39/:411-413 by contrast accepts phone OR email as a single identifier. After submit the user must also pass phone OTP (register.tsx:260-266 → verify-otp), then role-select, then (for runners) a mandatory document-upload gate before any app access.
- **Root cause:** The signup form demands the union of all identifiers (name + phone + email + strong password + terms) with no phone-OR-email choice, producing a heavy multi-screen funnel inconsistent with the flexible login.
- **Fix:** Allow phone OR email at registration (require only one contact channel, matching login), and consider deferring optional fields; each removed mandatory field measurably reduces signup drop-off on a mobile keyboard funnel.

**🟢 LOW · Brand-new runners are hard-trapped on the document-upload screen with only Log out as an exit**  `[new]`
- **Where:** `errandguy-mobile/src/app/(runner)/_layout.tsx`
- **Evidence:** runner/_layout.tsx:54-68 force-redirects any runner without the two required docs to '/(runner)/onboarding' on every navigation attempt; onboarding.tsx:390-404 offers only a Log out control (comment at :390-392: 'there is no skip'). Yet the same screen's info card (onboarding.tsx:521-523) tells them 'You can still explore the app while we review your documents' — which only becomes true AFTER upload (pending state passes the gate), contradicting the pre-upload lockout.
- **Root cause:** Verification gating is applied before any exploration is possible, while the reassurance copy is written as if exploration is already available.
- **Fix:** Either let an un-verified runner browse a limited read-only dashboard before uploading (matching the copy), or scope the 'you can still explore' line to the post-upload/pending state so the promise and the gate agree.

**🟢 LOW · Onboarding carousel is unreachable after first launch and there is no in-app 'How it works' replay**  `[new]`
- **Where:** `errandguy-mobile/src/app/(auth)/welcome.tsx`
- **Evidence:** welcome.tsx:86/:96 set '@onboarding_seen' and the root redirect (_layout.tsx:245-249) permanently routes returning users to login, so the 3-slide value/safety explainer is seen at most once. Neither profile hub's Support section (customer/(tabs)/profile.tsx:199-224, runner/(tabs)/profile.tsx:340-353) offers a replay/tour entry — only reactive Help & Support.
- **Root cause:** Onboarding is modeled as a one-shot first-run gate with no persistent entry point back into the explainer content.
- **Fix:** Expose a 'How ErrandGuy works' / replay-tour item in the Support/Help section so the value + safety explainer (and its SOS/trip-sharing messaging) is re-discoverable after the first session.


### qa

**🟠 HIGH · Gateway failure paths (timeout / 5xx / malformed body) essentially untested across checkout, top-up, and payout**  `[new]`
- **Where:** `errandguy-api/tests/Feature/Booking/CreateBookingTest.php:352`
- **Evidence:** CONFIRMED on current code. Enumerating every Http::response status across the whole tests/ suite yields only 200 (13x), 201 (1x) and exactly ONE non-2xx: a clean 400 at CreateBookingTest.php:352 (test_online_payment_failure_marks_booking_failed...). No test fakes a Xendit connection timeout/ConnectionException, a 5xx, or an empty/malformed gateway body for booking checkout, WalletTopUp, GatewayTip, LinkedMethod reconcile, or payout disbursement — grep for ConnectionException/timeout/pushException in tests/ returns nothing under any payment flow. tests/Feature/Support/ExceptionRenderingTest.php only throws PaymentGatewayException on synthetic ad-hoc routes (:29-37), never driving a transport failure through the real controllers. PaymentService wraps gateway calls in catch(\Throwable) and the async-invoice-off-queue design exists specifically to survive gateway flakiness, and MEMORY mandates 'gateway rejection -> 422 not app-level 502', yet no test proves the booking isn't left half-paid, no wallet is debited, promo isn't burned, and the response isn't a 502 when the transport itself fails.
- **Root cause:** Tests were written to the gateway happy path plus one well-formed 400 rejection; the transport-failure branches (timeout, 5xx, garbage body) that are the most common real-world gateway behavior were never faked.
- **Fix:** Add Http::fake cases returning Http::response('',503), a malformed body, and a pushed ConnectionException for the create-booking, wallet top-up, and payout-disbursement flows; assert 422 (never 5xx), no wallet debit, no orphaned/stuck booking, and promo un-burned.

**🟠 HIGH · No real concurrency test for wallet money-safety or runner double-accept; the 'concurrency guard' is a static source grep**  `[known-open]`
- **Where:** `errandguy-api/tests/Unit/WalletServiceLockingGuardTest.php:24`
- **Evidence:** CONFIRMED on current code. WalletServiceLockingGuardTest only reads each WalletService method's SOURCE and asserts the literal strings 'lockForUpdate' and 'DB::transaction' appear (:80-89); its own docblock states 'This is a static guard, not a concurrency test ... A true two-connection concurrency test (QA-3) is a separate, heavier follow-up' (:20-24). tests/Feature/Payment/MoneyIntegrityTest.php:16-18 likewise admits SQLite 'cannot reproduce true row-lock concurrency.' Runner double-accept is only tested sequentially (tests/Feature/Runner/ErrandAcceptTest.php:94 test_runner_cannot_accept_already_accepted_booking). grep for concurrent/race/parallel/pcntl/two-connection across tests/ finds no test that opens two DB connections and races them. The string-check gives false confidence: a refactor keeping the word 'lockForUpdate' in a comment would pass while atomicity is gone.
- **Root cause:** phpunit runs on in-memory SQLite (:memory:) that no-ops row-level lockForUpdate, so a genuine race cannot be reproduced in the default harness and was deferred (QA-3).
- **Fix:** Add a MySQL-only concurrency test (skip on sqlite) that spawns two connections/processes issuing simultaneous deduct() on one wallet and simultaneous accept() on one booking, asserting exactly one succeeds and balances/assignment stay consistent.

**🟡 MEDIUM · No coverage gate in CI — coverage is either disabled or computed and discarded, so untested critical code can deploy**  `[new]`
- **Where:** `errandguy-api/.github/workflows/backend-ci.yml:37`
- **Evidence:** Backend CI runs setup-php with coverage: none (backend-ci.yml:37 and :102), so no coverage is measured before the deploy job (:154) fires on push to main. Mobile test:ci runs jest --coverage (package.json) but jest.config.js has no coverageThreshold and no collectCoverageFrom, so the report is generated and thrown away — nothing fails on a coverage regression. Deploy is gated on tests PASSING, not on coverage of new code.
- **Root cause:** CI was built to enforce green tests and the MySQL matrix, but coverage measurement/thresholds were never wired in.
- **Fix:** Add a coverageThreshold (e.g. global + per-directory for src/services, src/stores) to jest.config.js and fail test:ci below it; enable coverage on the backend job (Xdebug/PCOV) with a minimum on app/Services money paths, or at minimum a coverage report artifact.

**🟡 MEDIUM · Mobile offline mutationQueue — the durable money/state replay engine — has zero tests**  `[new]`
- **Where:** `errandguy-mobile/src/services/mutationQueue.ts:11`
- **Evidence:** grep for 'mutationQueue' across *.test.* returns nothing. mutationQueue.ts is an AsyncStorage-backed replay queue whose docblock (lines 11-40) defines a hard safety contract: only idempotent last-write-wins actions may enqueue; 'Money moves, booking-state transitions, auth ... are NEVER queued'; and coalescing drops earlier entries with the same dedupeKey so a value replays once. None of this — the allowlist boundary, ordering, coalescing, or survive-app-kill rehydration — is covered by any test.
- **Root cause:** Mobile tests focus on stores/UI/utils; the service layer (queue, api client) was left uncovered.
- **Fix:** Unit-test mutationQueue: assert money/booking/auth kinds are rejected from the allowlist, that coalescing by dedupeKey replays only the newest value, ordered replay on reconnect, and correct rehydration after a simulated kill.

**🟡 MEDIUM · Mobile api client interceptor (401 handling, auth eviction, error normalization) is untested**  `[new]`
- **Where:** `errandguy-mobile/src/services/api.ts:293`
- **Evidence:** api.ts is a 460-line axios client with request+response interceptors, a 401 branch at :293, an in-memory cache with dedup, and error-shape normalization that the app's entire error handling (classifyError/errorCatalog) depends on. No test references apiClient/axios/interceptor/401/refresh except classifyError.test.ts. The 401->logout/token-eviction path and the {status,...} error normalization are unverified.
- **Root cause:** Same service-layer test gap; the client was treated as infrastructure rather than tested behavior.
- **Fix:** Add tests with a mocked axios adapter: assert 401 triggers the logout/eviction path exactly once, that silent requests suppress toasts, and that gateway/network errors are normalized to the shape classifyError expects.

**🟢 LOW · MatchingService lifecycle (offer fan-out -> accept race -> offer expiry -> rematch) only partially covered**  `[known-open]`
- **Where:** `errandguy-api/tests/Unit/MatchingServiceTest.php:50`
- **Evidence:** MatchingServiceTest has 8 tests but all cover candidate SELECTION only (online/approved/distance/nearest/preferred-types, plus broadcast eligibility at :149). StaleMatchReassignTest covers reassignment, but there is no end-to-end test of the full orchestration: multiple runners offered, one accepts while another's offer is in flight, offer expiry then automatic rematch to the next candidate. Matching correctness under multi-runner contention is thin (distinct from known-open PERF-BE-5 which is the correlated-subquery perf issue).
- **Root cause:** Matching was unit-tested at the query level; the job-driven offer/expiry/reassign chain was tested only in isolated pieces.
- **Fix:** Add a feature test that seeds 3 eligible runners, runs the dispatch job, expires the first offer, and asserts the booking rematches to the next-nearest runner and cannot be double-assigned.


### realtime

**🟠 HIGH · Runner errand cockpit has no realtime channel — cancellation/status lag up to 30s+**  `[known-open]`
- **Where:** `errandguy-mobile/src/app/(runner)/errand/[id].tsx:312`
- **Evidence:** CONFIRMED in current code. The cockpit's own comment (lines 312-315) states it wires NO realtime status channel ("this screen wires NO realtime status channel yet ... no useBookingStatus / realtime channel wired here"). Its only status path is useSmartPolling at line 321 with `interval: 30_000` and `runOnMount: false` (line 340), so the FIRST reconcile lands 30s after mount. grep confirms `useBookingStatus` is imported/used only on the customer side (book/confirm.tsx:293, tracking/[id].tsx:437) and NEVER in the runner cockpit. The infra already supports the runner: channels.php:38-44 authorizes the booking channel to BOTH customer_id AND runner_id, and BookingCancelled.php:34 broadcasts under the same `booking.status` event name as BookingStatusChanged.php:42. So the backend already pushes customer/admin cancellations to the runner; only the client subscription is missing, creating an asymmetry where the customer sees a cancellation live but the runner sees it up to 30s+ later and keeps shopping/driving in the meantime.
- **Root cause:** useBookingStatus/useEchoChannel is deliberately not mounted on the runner cockpit; the screen relies solely on a 30s reconcile poll (runOnMount:false) for all non-self-originated transitions (customer cancel, admin cancel/force-complete).
- **Fix:** Wire useBookingStatus(id) into errand/[id].tsx exactly as tracking/[id].tsx:437 does, push its payload into the runner store (updateErrandStatus for terminal, setState currentErrand otherwise — mirror the poll's store-sync side effect), and drop the poll to an adaptive fallback keyed on realtime health like tracking's realtimeHealthy→interval mapping. At minimum set runOnMount:true so the first reconcile isn't 30s out. This closes the window where a runner keeps working a booking the customer already cancelled.

**🟡 MEDIUM · Read receipts never update live for the sender — 'Read' label is stale until remount**  `[new]`
- **Where:** `errandguy-mobile/src/hooks/useChat.ts:340`
- **Evidence:** pollMessages (useChat.ts:340-372) is a forward-delta poll: it computes `newestId` = newest real message and requests `{ after: newestId }` (lines 353-364), so it only ever fetches messages CREATED after the newest one. When the counterpart reads the user's already-sent messages, no new row is created — server-side markAsRead only DB-updates read_at (ChatController.php:182-186, no event dispatched) — so the read_at change on existing messages is never delivered by the poll. There is no read-receipt broadcast event anywhere in app/Events. The chat screen only calls fetchMessages() on mount / manual reload (chat/[bookingId].tsx:342-356, 359-366); AppState 'active' fires only markAsRead (line 404-410), never a refetch. The sender's 'Read' indicator (chat/[bookingId].tsx:127-131, keyed on m.read_at) therefore never flips to Read while the sender stays on the conversation.
- **Root cause:** read_at mutations on existing messages have no realtime channel and are invisible to the forward-only delta poll; the only path that surfaces them is a full head-page fetchMessages(), which runs only on mount.
- **Fix:** Broadcast a lightweight `chat.read` event from ChatController::markAsRead on the chat.{bookingId} channel (payload: bookingId + reader id + read-through timestamp) and have chatStore stamp read_at on the sender's matching messages; OR have the poll periodically re-fetch the head page (not just after=) so read_at propagates. Either restores the shipped 'Read' feature to actual realtime.

**🟡 MEDIUM · Chat, notification, and booking-status broadcasts are all queued (ShouldBroadcast) — realtime == queue latency**  `[known-open]`
- **Where:** `errandguy-api/app/Events/ChatMessageSent.php:23`
- **Evidence:** ChatMessageSent (line 23 `implements ShouldBroadcast`), NotificationCreated.php (`implements ShouldBroadcast`), and BookingStatusChanged.php (`implements ShouldBroadcast`) all fan out via the queue; only RunnerLocationUpdated.php uses ShouldBroadcastNow (line 19). This means every 'realtime' chat message, in-app notification, and booking status change is delayed by queue-worker latency, and if the Forge queue worker is stalled or not running (memory note flags the queue worker as a go-live switch) live delivery is silently disabled for everything except the moving map pin. Chat is partially masked by the 8s poll fallback (useChat.ts:374-381), but notifications/status have coarser or no equivalent, so a backed-up worker degrades the whole realtime surface without any error surfaced to the user.
- **Root cause:** Latency-sensitive user-facing broadcasts (chat/notification/status) share the default queue with all other jobs and depend on the worker being healthy; there is no dedicated high-priority realtime queue and no client-visible degradation signal when the worker lags.
- **Fix:** Route these three events onto a dedicated, always-drained high-priority broadcast queue (or make ChatMessageSent ShouldBroadcastNow like the location event, with the same try/catch guard), and/or add a queue-depth health check to errandguy:check-prod-config so a stalled worker is alarmed rather than silently killing 'live' chat.

**🟢 LOW · Incoming-offer countdown is a client-side now()+30s, not the server's offer TTL**  `[new]`
- **Where:** `errandguy-mobile/src/hooks/useIncomingRequest.ts:21`
- **Evidence:** On a `booking.incoming` broadcast the hook sets `expiresAt: Date.now() + 30_000` (useIncomingRequest.ts:21), a hardcoded client assumption, even though the IncomingRequest payload carries server-authoritative timing (IncomingRequest.php broadcastWith includes matched_at and negotiate_expires_at). Because the offer arrives after a post-commit dispatch + Reverb delivery, and the countdown starts from the device clock at receipt rather than the server's matched_at, delivery latency and clock skew make the runner's visible 'time to accept' drift past the window the server actually enforces — the runner can watch a few seconds remaining after the offer has already lapsed/been reassigned server-side.
- **Root cause:** The accept-window countdown is derived from client receipt time instead of a server-stamped deadline in the payload.
- **Fix:** Base expiresAt on a server-provided deadline (add an explicit offer_expires_at to IncomingRequest::broadcastWith and use it; fall back to matched_at + window) so the client countdown matches the server's enforcement.


### security

**🟠 HIGH · SEC-1: KYC identity documents still served from the PUBLIC disk via unauthenticated URLs**  `[partially-fixed]`
- **Where:** `errandguy-api/app/Http/Controllers/Runner/RunnerDocumentController.php:62-68`
- **Evidence:** CONFIRMED against current code. store() writes government IDs / selfies / driver's licenses to the 'public' disk: $path = $file->storeAs("runner-documents/{userId}/{documentType}", $filename, 'public') (lines 63-67) then persists $fileUrl = Storage::disk('public')->url($path) as RunnerDocument.file_url (lines 68-73). config/filesystems.php:41-48 defines the 'public' disk with 'visibility' => 'public' and 'url' => APP_URL.'/storage', i.e. served directly by the web server (public_path('storage') symlink, filesystems.php:77) with NO auth. RunnerDocumentResource::toArray returns that raw file_url to the client (RunnerDocumentResource.php:15), so admin panel and mobile both surface the world-readable URL. The in-code comment at lines 57-61 explicitly states the file 'still lives on the PUBLIC disk' and that the private-disk fix is 'tracked separately'.
- **Root cause:** Remediation only closed the filename-enumeration vector (a 40-char CSPRNG token at line 62 replaced the guessable timestamp+enum path). It did NOT move KYC off the public disk. Anyone who obtains or leaks a document URL (HTTP referrer, forwarded admin link, log line, browser history, CDN cache) can view a stranger's government ID with no authentication, indefinitely; the files also persist through PRIV-1 account erasure unless separately purged.
- **Fix:** Store KYC docs on a private disk (config 'local' with visibility private, or S3 private) and serve them only through an authenticated controller that streams the file after an EnsureAdminUser/owner check, or via short-TTL Storage::temporaryUrl signed links. Stop persisting a raw public URL on runner_documents.file_url — store the storage path and mint access URLs on demand. The full fix exists on branch feat/sec-1-kyc-private-disk but is NOT merged to main.

**🟡 MEDIUM · Chat image uploads persisted on the PUBLIC disk (private conversation media world-readable if URL leaks)**  `[new]`
- **Where:** `errandguy-api/app/Http/Controllers/Chat/ChatController.php:130-133`
- **Evidence:** store('chat-images/'.$bookingId, 'public') writes user-uploaded chat photos to the public disk and stores Storage::disk('public')->url($path) on message.image_url. SendMessageRequest.php:21 validates image|mimes:jpeg,jpg,png,webp|max:5120 (good), but there is no access control on retrieval — the resulting URL is served unauthenticated like any public-disk asset.
- **Root cause:** Chat between customer and runner routinely carries receipts, delivery addresses, faces, and sometimes ID/document photos. store() uses a random-hashed filename (not enumerable), but any leaked URL is permanently viewable by anyone, and the images are not covered by booking-close expiry or (verify) PRIV-1 account erasure. Same class of exposure as SEC-1 at lower sensitivity.
- **Fix:** Move chat-images to a private disk and serve through a controller that reauthorizes the requester as a booking participant (mirror authorizeBookingParticipant), or via short-TTL signed URLs. Include chat images in the account-erasure/booking-retention purge.

**🟡 MEDIUM · Forgot-password endpoint is an account-existence oracle (user enumeration)**  `[new]`
- **Where:** `errandguy-api/app/Http/Requests/Auth/ForgotPasswordRequest.php:16-32`
- **Evidence:** rules() applies exists:users,email and messages() returns 'This email isn't registered. Check the address, or create an account.' as a 422. This fires at validation time BEFORE the controller, defeating the deliberately-neutral 'If an account exists…' message PasswordResetController::forgotPassword still returns at line 59. The request docblock openly labels it an 'account-existence oracle (enumeration)'.
- **Root cause:** A product decision (dated 2026-08 in the code) chose to reveal registration status inline. Combined with registration's duplicate-email/phone rejection, this enables bulk enumeration of the user base. throttle:auth (5/15min per credential, 30/15min per IP) only slows bulk probing; with spoofable X-Forwarded-For (see proxy-trust finding) the per-IP cap can be evaded.
- **Fix:** Return the neutral response for unknown emails (drop the exists rule / distinct message) to match the controller's already-correct behavior, or accept the tradeoff explicitly and at minimum tighten the throttle and ensure the real client IP is resolved. This was introduced/modified this session — flag for a product sign-off before it ships.

**🟡 MEDIUM · ADMIN-1: no MFA on the admin console — full money + PII control behind a single password**  `[known-open]`
- **Where:** `errandguy-api/app/Http/Controllers/Admin/AdminAuthController.php:36`
- **Evidence:** createToken('admin-token', ['admin']) is issued on password-only login (routes/api.php:350, throttle:auth). Admin routes (routes/api.php:352-384) allow markCompleted/markFailed on payouts, booking cancel, KYC approve/reject, and user suspend/unsuspend — i.e. money movement, identity approval, and account state changes — with no second factor.
- **Root cause:** AdminAuthController + EnsureAdminUser verify only instanceof AdminUser and is_active; there is no TOTP/WebAuthn step. A single leaked or phished admin credential grants complete operational and financial control.
- **Fix:** Add TOTP (or WebAuthn) as a second factor to admin login and to the Filament panel; consider IP allow-listing. Known-open item — CURRENT STATUS: still open on main.

**🟡 MEDIUM · TrustProxies is not safe-by-default — spoofable X-Forwarded-For breaks per-IP throttling and login lockout**  `[known-open]`
- **Where:** `errandguy-api/bootstrap/app.php:38-56`
- **Evidence:** The code's own comment: when TRUSTED_PROXIES is empty, on a *.on-forge.com host Laravel auto-trusts ALL proxies, so request->ip() becomes the left-most X-Forwarded-For — SPOOFABLE if the origin is reachable directly. The login limiter (login: keyed identifier|ip and login-ip:ip), the unauthenticated api limiter (Limit::perMinute(20)->by($request->ip())), and the otp limiter all derive their key from ip().
- **Root cause:** Security depends on an off-repo runtime invariant (TRUSTED_PROXIES set to specific Cloudflare/LB ranges AND the origin firewalled to Cloudflare-only). If either is missing in prod, an attacker rotating a forged X-Forwarded-For evades per-IP throttles and the AUTHX-3 credential+IP lockout, reopening brute-force / lockout-DoS vectors.
- **Fix:** Verify in Forge env that TRUSTED_PROXIES is set to Cloudflare (and LB) IP ranges and that *.on-forge.com is firewalled to Cloudflare only. Add errandguy:check-prod-config coverage (or a boot guard) that WARNs when running on-forge with an empty TRUSTED_PROXIES.

**🟢 LOW · GET /config/app returns the entire SystemConfig table to any authenticated user (least-privilege / no public-key filter)**  `[new]`
- **Where:** `errandguy-api/routes/api.php:264-270`
- **Evidence:** The route returns SystemConfig::pluck('value','key') with no is_public/whitelist filter. Any authenticated customer or runner receives every config key. The system_config migration has no visibility column; SystemConfig::setValue can add arbitrary keys from the admin at runtime.
- **Root cause:** Today the seeded keys are only operational (platform_fee_percent, runner_payout_percent, timeouts) — not secrets — so present impact is low. But there is no schema-level guard, so any future key an admin adds (a gateway flag, an internal threshold, a webhook hint) is silently exposed to all end users the moment it is written.
- **Fix:** Add an is_public boolean to system_config and filter the /config/app query to is_public=true (or maintain an explicit client-safe key allowlist in the route). Prevents a future config addition from becoming an inadvertent disclosure.

**🟢 LOW · Avatar uploads use a low-entropy, semi-predictable filename on the public disk**  `[new]`
- **Where:** `errandguy-api/app/Http/Controllers/Customer/ProfileController.php:57-58`
- **Evidence:** filename = 'avatars/' . $user->id . '_' . Str::random(8) . '.' . ext, stored via storeAs('', $filename, 'public'). Only 8 random chars of entropy appended to a known UUID prefix, on the public disk.
- **Root cause:** Avatars are low-sensitivity, but the 8-char suffix on a discoverable user-id prefix is weaker than the 40-char token used for KYC; a determined party could brute a specific user's avatar path. Included for consistency, not urgency.
- **Fix:** Use Str::random(40) (or Str::uuid) for the avatar filename to match the KYC token strength; optionally move to a hashed path that does not embed the user id.


### Backend performance

**🟡 MEDIUM · PERF-BE-3 still open on prod: admin substring search full-scans users on MySQL (trgm index is Postgres-only)**  `[known-open]`
- **Where:** `errandguy-api/database/migrations/2026_07_26_000001_add_users_trgm_search_indexes.php`
- **Evidence:** up() begins with if driver !== 'pgsql' return, then only creates pg_trgm GIN indexes. Prod DB was migrated from Postgres to MySQL, so this migration is a no-op in production and no index is ever created. The queries it targets remain: UserManagementController.php:22-24 (full_name/email/phone LIKE %term%) and BookingManagementController.php:25-26 (booking_number LIKE plus orWhereHas customer full_name LIKE). Leading-% LIKE is unindexable and MySQL has no trgm-GIN equivalent, so every admin user/booking search is a full sequential scan of users, growing with user count. The 39 Filament searchable columns emit the same leading-wildcard LIKE.
- **Root cause:** Acceleration was authored as pg_trgm GIN indexes guarded to run only on pgsql, but production runs MySQL, so the guard silently disables it on the one engine that ships.
- **Fix:** Ship an engine-aware migration: on MySQL add a FULLTEXT index on users(full_name,email,phone) with boolean-mode MATCH...AGAINST, or a normalized search column; at minimum require a min search length and hard-paginate. Currently deferred-but-not-run; safe only while users table is small.

**🟢 LOW · Heatmap/peak-hours aggregate materializes a function-grouped scan over the full N-day booking window**  `[known-open]`
- **Where:** `errandguy-api/app/Http/Controllers/Runner/HeatmapController.php`
- **Evidence:** heatmap() lines 40-48 group by round(pickup_lat,3),round(pickup_lng,3); peakHours() lines 83-89 group by dayofweek/hour(created_at), both over created_at >= now-Ndays (days up to 90). GROUP BY keys are function-derived so no index satisfies grouping; MySQL builds a temp table + filesort. The created_at range is index-backed (idx_bookings_created_at) and results are SWR-cached (soft 900s/hard 1800s), keeping it off the synchronous path nearly always.
- **Root cause:** Geo/time bucketing computed with SQL functions instead of precomputed bucket columns, so the aggregate cannot be index-satisfied.
- **Fix:** Acceptable given SWR cache. If volume grows, materialize a rolled-up demand table via a scheduled job and read that instead of aggregating raw bookings.

**🟢 LOW · Admin dashboard runs ~11 synchronous full-table COUNTs on every cache miss**  `[new]`
- **Where:** `errandguy-api/app/Http/Controllers/Admin/DashboardController.php`
- **Evidence:** stats() lines 30-49 issue separate counts including Booking::count() and Booking::whereNotIn('status',[...])->count() (unindexed status-exclusion over the whole table). Wrapped in CacheService::remember at 600s TTL, so cost lands only on the first request after each expiry, but that one request pays all ~11 aggregates serially under a single global key with no lock.
- **Root cause:** Independent aggregates issued as separate round-trips behind one global cache key, so every 10 minutes one admin eats the full recompute.
- **Fix:** Collapse into grouped queries (single status group-by for bookings, single role group-by for users) and/or move to CacheService::swr so a stale value is served while a background job refreshes.

**🟢 LOW · PERF-BE-5 matching subquery — current status: substantially mitigated**  `[known-open]`
- **Where:** `errandguy-api/app/Services/MatchingService.php`
- **Evidence:** getEligibleRunners() lines 127-129 still use whereDoesntHave('user.runnerBookings', status NOT IN [...]), a two-hop correlated NOT EXISTS. But it now runs after a bounding-box prefilter (110-116) plus is_online + verification_status=approved + last_location_at freshness, and the set is capped by orderByRaw(planar distance)+limit (138-142). The subquery inner predicate is index-backed by idx_bookings_runner_status_completed. So it evaluates over a small bounded candidate set, not every online runner.
- **Root cause:** Correlated subquery is inherent to excluding runners with an active errand, but its blast radius is now bounded by the geo/status prefilters preceding it.
- **Fix:** No action needed at current scale. At very high per-cell online density, denormalize an active_booking_id/is_available flag on runner_profiles (maintained on accept/complete) to drop the join.


### Data model & schema integrity

**🟡 MEDIUM · No DB-level enum/CHECK on any status/role/type column — enums are PHP-only and not even cast**  `[new]`
- **Where:** `errandguy-api/database/migrations/2026_03_26_200004_create_bookings_table.php:17`
- **Evidence:** bookings.status is string(25) default 'pending' (line 17); payments.status is string(15) (2026_03_26_200007_create_payments_table.php:18); bookings.payment_status string(15) (2026_07_05_000001_add_payment_fields_to_bookings.php:20); users.role/status string (0001_01_01_000000_create_users_table.php:18-19); wallet_transactions.type string(15) (2026_03_26_200009...:14); runner_profiles.verification_status string(15). The only DB CHECK in the whole schema is chk_reviews_rating_range (2026_07_23_000001_add_money_integrity_constraints.php:158). App\Enums\PaymentStatus and BookingPaymentStatus exist but grep confirms neither Booking.php nor Payment.php casts 'status'/'payment_status' to those enum classes, and Payment::create is called at 5 raw sites in BookingController.php (311/384/396/416/473) that write status as a plain string.
- **Root cause:** Status vocabularies live entirely in application code (PHP enums + transitionTo() guard). The DB accepts any string in these columns, and the models don't even bind the enum as an Eloquent cast, so there is no read-side coercion or write-side rejection of a typo/bad value.
- **Fix:** Add MySQL 8 CHECK constraints (guard-if-clean, same pattern as the money-integrity migration) for each finite-vocabulary column, and add native enum casts in casts() (e.g. 'status' => BookingPaymentStatus::class for payment_status, PaymentStatus::class for payments.status). This turns silent bad states into DB errors and read-time type safety.

**🟡 MEDIUM · DATA-2 still open and now two enums disagree on the token for 'settled' (paid vs completed)**  `[known-open]`
- **Where:** `errandguy-api/app/Enums/BookingPaymentStatus.php:17`
- **Evidence:** BookingPaymentStatus::Paid = 'paid' (line 17) is the settled token on bookings.payment_status, while PaymentStatus::Completed = 'completed' (app/Enums/PaymentStatus.php:23) is the settled token on payments.status. The two columns are independent VARCHARs with no DB linkage, trigger, or generated column keeping them in sync; the webhook path (XenditWebhookController.php:245/356) and Payment::create sites update them separately.
- **Root cause:** Settlement state is denormalized across bookings.payment_status and payments.status with divergent vocabularies and only application-code synchronization, so any partial write (webhook lands, booking update fails, or vice-versa) leaves the two permanently inconsistent with no reconciler for THIS pair (the wallet reconciler does not cover payment_status drift).
- **Fix:** Pick one canonical vocabulary, or add a scheduled reconciler (like errandguy:reconcile-wallets) that flags/repairs rows where payments.status='completed' but bookings.payment_status<>'paid' and vice-versa. Longer term, derive bookings.payment_status from the payment row rather than storing it twice.

**🟡 MEDIUM · payments has no uniqueness per booking, but Booking::payment() is hasOne — arbitrary-row ambiguity**  `[new]`
- **Where:** `errandguy-api/database/migrations/2026_03_26_200007_create_payments_table.php:26`
- **Evidence:** payments.booking_id has only a plain FK + non-unique index (lines 26-28); the money-integrity migration added unique only on gateway_tx_id, not booking_id. Booking.php:173-176 exposes payment() as hasOne(Payment::class). BookingController.php creates Payment rows at 5 separate call sites (311/384/396/416/473) with no firstOrCreate/unique guard, so a retried online payment can produce multiple rows for one booking.
- **Root cause:** The relation assumes one payment per booking but the schema does not enforce it; hasOne with no orderBy returns a driver-arbitrary row, so once a booking has >1 payment row (retry, method switch), BookingResource can surface a stale/wrong payment amount or status.
- **Fix:** Either enforce one active payment per booking (partial unique on booking_id where status not in terminal-failed, or firstOrCreate at the write sites) or make payment() a deterministic latestOfMany()/ofMany on paid_at/created_at so the displayed payment is well-defined.

**🟢 LOW · bookings.cancelled_by has no FK to users while the analogous changed_by column does**  `[new]`
- **Where:** `errandguy-api/database/migrations/2026_03_26_200004_create_bookings_table.php:59`
- **Evidence:** bookings.cancelled_by is uuid()->nullable() (line 59) with no ->foreign() declaration (the FK block at lines 69-71 covers only customer_id/runner_id/errand_type_id). By contrast booking_status_logs.changed_by DOES get an FK to users (2026_03_26_200005_create_booking_status_logs_table.php:22), and the later promo_code_id and sos_alerts.triggered_by columns were both retrofitted with guard-if-clean FKs.
- **Root cause:** The actor column was added without referential integrity, so a cancelled_by value can point at a non-existent (or hard-deleted) user with nothing to catch it — an orphan-actor hazard in an audit-relevant column.
- **Fix:** Add a guard-if-clean FK bookings.cancelled_by -> users.id ON DELETE SET NULL using the same pattern as 2026_07_24_000001_add_bookings_promo_code_fk.php.

**🟢 LOW · booking_stops breaks the house timestampTz convention (timestamp/timestamps), tz-naive vs tz-aware mix**  `[new]`
- **Where:** `errandguy-api/database/migrations/2026_08_07_000003_create_booking_stops_table.php:32`
- **Evidence:** Every other table standardizes on timestampTz/timestampsTz (bookings, payments, wallet_transactions, reviews, runner_profiles all use ...Tz). booking_stops (the newest table) uses $table->timestamp('completed_at') (line 32) and $table->timestamps() (line 33), which are tz-naive column builders.
- **Root cause:** On MySQL both map to TIMESTAMP so it is currently cosmetic, but the memory notes list both MySQL and a pgsql Forge history; on Postgres timestampTz becomes timestamptz while timestamp becomes 'timestamp without time zone', producing a single DB that mixes tz-aware and tz-naive columns and risking off-by-timezone comparisons if the completed_at flow is ever driven.
- **Fix:** Change booking_stops to timestampTz('completed_at') and timestampsTz() to match the rest of the schema before the per-stop completion flow goes live.

**🟢 LOW · Two pairs of migrations share identical timestamp prefixes**  `[new]`
- **Where:** `errandguy-api/database/migrations/2026_07_24_000001_add_bookings_promo_code_fk.php:1`
- **Evidence:** ls of database/migrations shows prefix 2026_04_27_000001 used by BOTH add_triggered_by_to_sos_alerts and relax_dropoff_and_add_shopping_fields, and 2026_07_24_000001 used by BOTH add_bookings_promo_code_fk and add_bookings_status_created_index.
- **Root cause:** Laravel batches/orders migrations by full filename string, so collisions resolve deterministically alphabetically and both run — but colliding prefixes defeat the intended chronological ordering signal and are fragile if a future migration must sit between the two colliding ones.
- **Fix:** Rename the second file in each colliding pair to a distinct suffix number (e.g. ..._000002_...) to restore unique, chronologically-meaningful ordering. Low risk since both have already run in every environment.


### scale-reliability

**🟡 MEDIUM · withoutOverlapping() left at Laravel's 24h default mutex TTL on file cache — an OOM/SIGKILL mid-run can silence the money-safety reaper for up to a day (real but narrower than originally stated)**  `[new]`
- **Where:** `errandguy-api/routes/console.php:68`
- **Evidence:** CONFIRMED in current code: all three scheduled tasks call ->withoutOverlapping() with no expiry — CheckRideDurationJob (console.php:51), ExpireStaleMatchesJob (console.php:58), errandguy:reap-stranded-bookings (console.php:68). vendor/.../Scheduling/ManagesAttributes.php:180 shows the default expiresAt=1440 min, and vendor/.../Scheduling/CacheEventMutex.php:45 acquires the lock with TTL expiresAt*60 = 86400s (24h). config/cache.php:23 defaults the store to 'file' and no Redis is provisioned (MEMORY), so the lock is a filesystem entry that survives process death. The reaper runs inline via Schedule::command (console.php:66), so a mid-run kill of the schedule:run process leaves a stuck lock and every subsequent 5-min tick skips the reaper for 24h. HOWEVER the original 'high / common during deploys' framing is overstated: ManagesAttributes.php:180 defaults releaseOnTerminationSignals=true and Event.php:145+889-906 (ensureMutexIsReleasedOnSignal) trap SIGTERM/SIGINT/SIGQUIT to call removeMutex() on graceful termination when pcntl is loaded, and on Forge schedule:run is a fresh per-minute cron invocation that deploys do not kill. The genuine residual trigger is limited to an untrappable SIGKILL (OOM killer), a host reboot mid-run, or a CLI without pcntl — a compound failure (worker outage stranding a prepaid booking AND the scheduler dying during a reap window). No money is lost; recovery is merely delayed up to 24h in that double-failure case.
- **Root cause:** withoutOverlapping() left at the framework default 1440-minute (24h) lock TTL, which vastly exceeds the 5-minute cadence of the money-safety backstop; on file cache the lock is only self-released on graceful signals (pcntl) or lock expiry, not on an untrappable OOM/SIGKILL.
- **Fix:** Pass an explicit short expiry matching cadence so a hard-killed run self-heals on the next tick instead of stalling 24h: ->withoutOverlapping(10) for the every-5-min reaper and CheckRideDurationJob, ->withoutOverlapping(2) for the every-minute ExpireStaleMatchesJob. Adopt onOneServer only if a coordinated cache (redis/database) is provisioned.

**🟡 MEDIUM · Stale-match rescue and the overdue-ride SAFETY monitor are queue-worker-dependent (Schedule::job), unlike the money reaper**  `[partially-fixed]`
- **Where:** `errandguy-api/routes/console.php:57`
- **Evidence:** ExpireStaleMatchesJob (line 56-58) and CheckRideDurationJob (line 49-51) are scheduled via Schedule::job(...), which merely PUSHES the job onto the queue every tick — execution requires a live queue worker. The reaper was deliberately made Schedule::command (line 62-68, comment: 'runs in the scheduler process ... survives a queue-worker outage'). So during a worker outage: (a) fixed bookings stuck on 'Runner Found' after a runner ignores the offer are never re-matched to a different runner (ExpireStaleMatchesJob, app/Jobs/ExpireStaleMatchesJob.php:375 never runs) — they just wait until the created_at-based reaper cancels+refunds; and (b) the overdue-in-transit-ride safety alert (CheckRideDurationJob, app/Jobs/CheckRideDurationJob.php:657) never fires, so a ride running far past its estimate raises no alert. The reaper protects the money but not these UX/safety functions.
- **Root cause:** Only the money-refund backstop was moved to a worker-independent Schedule::command; the safety monitor and re-match rescue were left on the queue path.
- **Fix:** Convert CheckRideDurationJob (safety-critical) to a Schedule::command that runs its logic inline in the scheduler, or add a command-based backstop for overdue rides. ExpireStaleMatchesJob can stay queued but document that its rescue is best-effort during worker outages and that the reaper is the money guarantee.

**🟡 MEDIUM · Queue driver = database + Reverb scaling disabled + no Redis = single-node ceiling for queue throughput and websocket fan-out**  `[known-open]`
- **Where:** `errandguy-api/config/queue.php:41`
- **Evidence:** QUEUE_CONNECTION defaults to 'database' (config/queue.php:41); config/reverb.php:40 has scaling.enabled default false and points its scaling server at REDIS_* which MEMORY notes is not provisioned ('no Redis/phpredis here', Redis GEO matching BLOCKED). config/cache.php:23 defaults to file. Consequence at the stated 10k-concurrency target: the DB queue serializes on the single jobs table with polling workers (delayed AutoCancelBookingJob rows accumulate with far-future available_at), a single Reverb process holds every websocket connection with no horizontal scaling path, and cache/locks/rate-limiting are per-node file storage. Every runner location ping also drives a ShouldBroadcastNow publish through that one Reverb instance.
- **Root cause:** Production infra never provisioned Redis, so queue/broadcast/cache all fall back to single-node stores; this is the known infra ceiling.
- **Fix:** Provision Redis (or a managed equivalent), set QUEUE_CONNECTION=redis, REVERB_SCALING_ENABLED=true, CACHE_STORE=redis, and add multiple queue workers. Until then, add a Redis-mandatory guard for prod and cap expectations. Off-repo config change.

**🟢 LOW · MySQL connection carries no persistent-connection / pooling tuning — only the legacy pgsql block got it**  `[new]`
- **Where:** `errandguy-api/config/database.php:62`
- **Evidence:** The active mysql connection's options array (config/database.php:62-64) sets only MYSQL_ATTR_SSL_CA. The carefully-added PDO::ATTR_PERSISTENT (env DB_PERSISTENT) and PDO::ATTR_EMULATE_PREPARES (env DB_EMULATE_PREPARES) tuning — meant to avoid paying the TCP+TLS handshake per request against a cross-region/pooled DB — exists ONLY on the now-legacy pgsql connection (lines ~140-160). Since prod runs MySQL, none of that is reachable: every PHP-FPM worker opens and re-opens a fresh MySQL connection, and there is no pooling, so MySQL max_connections is the hard ceiling under a connection storm.
- **Root cause:** The connection-reuse optimization was written before/around the pg→MySQL migration and never ported to the mysql/mariadb connection blocks.
- **Fix:** Add PDO::ATTR_PERSISTENT (gated on env DB_PERSISTENT, default null/off) to the mysql/mariadb options arrays if the prod DB is remote/pooled; if app+DB are co-located on the same Forge box this is optional, but the asymmetry with pgsql should be resolved deliberately.

**🟢 LOW · CheckRideDurationJob loads all in-transit transportation rides with no LIMIT under a 60s worker timeout**  `[new]`
- **Where:** `errandguy-api/app/Jobs/CheckRideDurationJob.php:662`
- **Evidence:** handle() runs Booking::where('is_transportation',true)->where('status','in_transit')->whereNotNull('picked_up_at')->where('sos_triggered',false)->get() with no ->limit() and no chunking, then loops per row doing a cache lookup + possible event dispatch. The class sets tries=1 (line 655) and inherits the default 60s worker timeout (no $timeout override). Sibling sweeps were explicitly bounded (ExpireStaleMatchesJob uses ->limit(100); the reaper uses MAX_PER_RUN=500), but this one was not. A large simultaneously-in-transit fleet loads the full set into memory in one job; if it exceeds 60s it is killed with tries=1 and never retried, so an overdue-ride alert can be silently dropped that cycle.
- **Root cause:** Unbounded eager .get() in a safety-monitor job that was not given the same limit/chunk treatment as the other sweeps.
- **Fix:** Chunk the query (chunkById) or add a bounded ->limit() with ordering by picked_up_at so the oldest in-transit rides are always evaluated first, keeping the run under the timeout.

**🟢 LOW · Scheduled fixed-price matching is fully queue-worker-dependent with no worker-independent match backstop**  `[new]`
- **Where:** `errandguy-api/app/Http/Controllers/Customer/BookingController.php:528`
- **Evidence:** Scheduled bookings dispatch MatchRunnerJob::dispatch(...)->delay($matchAt) (line 528) — immediate ones use dispatchSync (line 535) specifically so the customer 'doesn't depend on a queue worker being healthy' (comment lines 530-534). If the worker is down when $matchAt fires for a scheduled booking, matching never runs; the row stays pending and the only thing that acts on it is the reaper, which CANCELS+refunds it (scheduled_at + auto_cancel window, ReapStrandedBookingsCommand). So a worker outage silently converts a valid future scheduled booking into an auto-cancellation rather than a match — money is safe but the service is not delivered and there is no worker-independent retry of the match itself.
- **Root cause:** The deliberate 'run matching in-request to survive worker outage' design applies only to immediate bookings; scheduled matching has no equivalent command-based fallback.
- **Fix:** Add a Schedule::command sweep that picks up scheduled fixed bookings whose matchAt has passed and are still pending (and not yet at the auto-cancel window) and runs matching inline, so a worker outage delays rather than cancels the booking.

---

## 14. Prioritized Implementation Roadmap

*Ordered by impact. Many Quick Wins are safe, self-contained backend fixes the audit newly surfaced.*

### 🚀 Quick Wins (high value / low effort / safe to ship now)
- **Redact PII from logs** (🟠 privacy): stop logging the trusted-contact phone in cleartext (`SendSafetyAlertNotification`) and the SOS/trip-share token via full-URL logging (`LogApiRequests`). One-line redactions; reintroduces the discipline the earlier log-hygiene work established.
- **Gate the REST admin API by role + audit it** (🟠 admin-ops): `EnsureAdminUser` only checks `is_active`, so any admin token can hit money/user endpoints the Filament UI restricts. Enforce `canManageMoney`/`canManageSystem`/`canHandleSupport` per route and write an audit entry on each admin money/user action.
- **Re-enable OS font scaling** (🟠 mobile-ux): remove the global `allowFontScaling=false` / raise `maxFontSizeMultiplier` on the core journeys — fixes the WCAG 1.4.4 failure.
- **Harden the scheduler** (🟠 devops/scale): add `->onOneServer()` + a heartbeat/`pingOnFailure`; move `CheckRideDurationJob` and `ExpireStaleMatchesJob` from `Schedule::job` (queue-dependent) to `Schedule::command` so they survive a worker outage like the reaper does; pass an explicit short `withoutOverlapping()` TTL so a killed run can't silence the money backstop for 24h.
- **Fix the CI deploy step** (🟠 devops): `curl --fail` + response check so a Forge-rejected deploy stops reporting green.
- **One `booking_number` generator** (backend-arch): route all three sites through the collision-safe helper.
- **Uniform forgot-password response** (security): remove the account-existence oracle.

### 🎯 High-Impact Improvements (launch blockers)
- **DR + safe deploy** (🔴 critical): automated MySQL backups + binlog PITR with a documented RPO/RTO and a real restore drill; a pre-migrate snapshot, a health gate, and a rollback path (expand/contract migrations); stop the bare `migrate --force`.
- **Alerting delivery** (🟠 devops): wire Sentry/Bugsnag (backend, tagged with request_id) + the Slack webhook so the reconciler's CRITICAL wallet-divergence and prod-config CRITICAL lines actually page someone instead of dying in a 14-day local log.
- **SEC-1 KYC private disk** (🟠 security): merge `feat/sec-1-kyc-private-disk` (after the on-device + Filament render checks), run the migrate-to-private command, purge public copies; move chat images too.
- **Admin MFA + payout-destination lock** (🟠 admin-ops): Filament MFA required for money roles; lock ad-hoc payout to the runner's verified KYC destination or require dual-control, and log the destination.
- **Complete erasure + DPA notice** (🟠 privacy): include chat messages + chat images in `deleteAccount`; replace the placeholder privacy notice with a compliant one (controller/DPO, processors: Xendit/FCM/Expo/HERE, lawful bases, retention, NPC route) and reconcile the version string.
- **Online pre-settlement dispatch** (🟠 money): a runner can currently complete an unpaid online errand and be credited nothing; gate dispatch/completion on settlement (or guarantee credit-on-late-settlement and surface the pending state).
- **Runner cockpit realtime** (🟠 realtime): wire `useBookingStatus` into the runner errand screen so a cancellation isn't 30s+ stale.
- **Production config** (off-repo): `APP_DEBUG=false`, real EAS Reverb/API keys, provision Redis for cache/queue/session/broadcast + enable Reverb scaling.

### 🏗️ Long-Term Enhancements (architecture & scale)
- `BookingStatus` enum + bind the payment enums as Eloquent casts + DB CHECK constraints on all lifecycle/role columns; resolve the `paid`-vs-`completed` token split (DATA-2).
- Decompose `BookingController::store()` into a `CreateBookingAction` + per-method `PaymentCollector`; delete the dead `processBookingPayment`.
- Decompose the three god-screens; retype the service layer (kill the 145 `as any`, especially the estimate/money path); fix `book/details` whole-screen re-render on keystroke.
- Read replica for track/earnings/heatmap reads; managed HA MySQL; multi-node Reverb behind a LB.
- Real two-connection concurrency tests (wallet + runner double-accept), a CI coverage gate, gateway-failure-path tests, and mobile offline-queue/api-client tests.
- Pricing/business decisions: routed distance (PRICE-1), runner cancellation-fee share + no-show endpoint (PRICE-2), promo cap (PRICE-5), 12% VAT/BIR receipts (PRICE-6), negotiate take-rate (PRICE-7).
- DSAR "download my data" export; lawful-basis + notice for third-party (trusted-contact) PII.

---

## Appendix — Remediation credited & verified this session

This audit independently re-verified the following as **holding in the current code** (not re-reported as gaps): the money settlement seam (late-settlement backfill, cash commission, capped/zeroed cancel fee, retry-match refund guard); every `WalletService` balance mutation being `lockForUpdate` + `DB::transaction` + idempotent + bucket-aware; the wall-clock reaper (stranded fixed/scheduled/negotiate + cancelled+paid refund-orphans); the wallet reconciler + locking arch-guard; idempotency + webhook dedup + dedup-table prune; `runner_locations` index + chunked prune; push-delivery bounding + queueing; RT-1..RT-5 realtime correctness; PRIV-1 erasure core + PRIV-2 consent; AUTHX-3 login lockout; CONTRACT-1; PRICE-3/4; the dual-engine (SQLite + MySQL 8) CI. Suite: 520 tests green on both engines.

*Generated 2026-08-12 by an independent 28-agent adversarially-verified sweep over the current tree. Findings cite `file:line` in the current code; re-verify line numbers before editing.*
