# ErrandGuy — Production Readiness Audit & Gap Analysis
**Date:** 2026-08-13 · **Method:** independent multi-lens audit (CTO / Architect / PM / UX / Backend / Frontend / DevOps / QA / Security / Performance / SRE), code-grounded, adversarially verified · **Prior baseline:** 66/100 (2026-08-12)

---

## 1. Executive Summary

ErrandGuy is a Philippine on-demand **errand + rideshare marketplace** (Laravel 13 API + Expo/React-Native app + Filament admin) connecting customers to runners across delivery, transportation, shopping, bills-payment, and queueing errands, settled via wallet, cash, or Xendit online payments.

**Headline: the *code* is production-grade; the *operations* are not yet.** After this session's remediation (25 commits total), the money, security, and concurrency seams are genuinely strong — verified, not assumed: no IDOR, no mass-assignment, verified webhooks, bound SQL, full security headers, decimal-correct money columns, comprehensive eager-loading (no N+1), and the two hardest races (SOS one-active-alert, promo per-user limit) closed with row locks + concurrency proofs. The mobile app is unusually polished — best-in-class data/offline/realtime/payment plumbing and exceptional empty/loading/error-state coverage.

What holds it back from a confident public launch is **operational**: the platform is **operationally blind** (no error tracking, no APM, a boot-only health probe) and **single-homed** (MySQL, Redis, Reverb, FPM, worker all on one Forge box), the deploy runs an **irreversible `migrate --force`** with a non-atomic release and (until this session) no fresh pre-migrate backup, and a **mobile release-blocker** (placeholder Reverb key in the production EAS profile) would ship a store build with realtime dead. Plus finishing items with outsized impact: **raw phone numbers exposed** on the call button, **Dynamic Type disabled** app-wide, and a **hard login wall** with no guest browse.

**Verdict: launchable for a controlled soft/beta launch; not yet for a high-traffic public launch** until observability, the mobile config blocker, and the trust/accessibility items close.

## 2. Score

### **72 / 100** — *Conditionally launch-ready* (▲ from 66)

The 6-point rise reflects this session's money/security/reliability hardening. The ceiling is set by DevOps/observability (42) and scalability/reliability (55): a system you cannot see and cannot cheaply recover is not ready for real traffic, however correct its code.

| Dimension | Score | Trend |
|---|---|---|
| Security | 86 | ▲ strong |
| Performance (backend) | 88 | strong |
| Mobile UX | 85 | strong |
| Product completeness | 82 | strong |
| Mobile performance | 82 | strong |
| Backend architecture | 74 | solid |
| Mobile architecture | 74 | solid |
| Business-logic completeness | 66 | gaps |
| Mobile maintainability | 61 | thin tests |
| Scalability / reliability | 55 | single-homed |
| **DevOps / observability** | **42** | **the gate** |

## 3. What The Application Does (from the code)

- **Customer:** OTP/password auth → create a booking (5 errand types; fixed or *negotiate* pricing; multi-stop; scheduled or now) → matched to a nearby runner (radius + haversine + preferred-types + online/recency filters) → live map tracking + chat + SOS/live-trip-share → pay (wallet / cash / online Xendit invoice or e-wallet) → tip → rate. Plus wallet top-up, promos, referrals.
- **Runner:** onboarding → **KYC document upload** (gov ID / selfie / licence) → admin verification → go online → receive broadcast offers → accept → navigate → complete with proof (photo/receipt/signature) → earnings settle to wallet (paid → credit payout; **cash → keep fare, wallet debited platform commission**; unsettled → nothing) → request payout.
- **Admin (Filament):** ops dashboard, booking/user/runner moderation, KYC verification, disputes, payouts (Xendit disbursement), promo/errand-type catalog, activity log, push broadcast.
- **Infra:** MySQL 8, Redis (cache/queue/session/throttle), Reverb (websockets), Expo Push over FCM, on Laravel Forge.

## 4. Architectural Assessment — 74/100

**Strengths:** real service layer (`PricingService`, `WalletService`, `BookingSettlementService`, `PaymentService`), a `Payment` state machine, idempotency middleware + gateway keys, an append-only `wallet_transactions` ledger with `balance_after`, role-scoped routes with a capability middleware, and worker-independent scheduler backstops.

**Weaknesses:**
- 🟠 **`BookingController::store()` is a 515-line god-method** ([BookingController.php:105-620](errandguy-api/app/Http/Controllers/Customer/BookingController.php#L105)) — pricing + negotiate + promo + booking create (in a tx) + **5-way payment collection inline** + match/broadcast/events. **Root cause:** no booking-creation/payment-collection orchestrator; `PaymentService` exists but isn't used here, so the gateway is charged *after* the booking commits (relies on `failBooking()` compensation). **Fix:** extract `PaymentService::collectForBooking()` + a thin `BookingCreationService`; controller → validate + delegate.
- 🟠 **Response-envelope adoption ~30%** — 140 raw `response()->json()` vs 59 helper calls; `store()` returns a raw shape lacking `success`/`code`/`meta.request_id`. **Fix:** migrate raw returns to `ApiResponse` helpers (mechanical, backward-compatible).
- God-classes: `WalletService` 976 LOC, `PaymentService`/`RunnerErrandController` 773, `XenditWebhookController` 647 — cohesive but large; split as they grow.

## 5. Business-Logic Assessment — 66/100

Covers the hard paths well (booking, multi-stop, scheduled, negotiate, promo, payout, refund, **cash settlement verified correct**). Gaps:
- 🟠 **Dispute workflow is broken in two places.** (1) Disputes are created `'open'` ([SupportController.php:54](errandguy-api/app/Http/Controllers/Support/SupportController.php#L54)) but the ops dashboard counted `where('status','active')` — a status that is **never set** — so new disputes were invisible on the ops tile. **[FIXED this session.]** (2) `DisputeController::resolve()` ([DisputeController.php:46](errandguy-api/app/Http/Controllers/Admin/DisputeController.php#L46)) sets status + note + notifies, but triggers **no refund/wallet movement** — resolution is disconnected from money. **Fix:** accept optional `refund_amount` → `WalletService::refund()` in a transaction, ledgered against the dispute.
- 🟡 **No tax/VAT/withholding** anywhere — a PH marketplace owes 12% VAT + likely creditable withholding on payouts (BIR); receipts/earnings PDFs carry no breakdown. **Fix:** `config/tax.php` + VAT line in pricing + withholding line on statements.
- 🟡 **Business-feature gaps:** no gift cards, no coupons beyond `PromoCode`, single-entry ledger (no offsetting account rows), one runner-earnings PDF and no admin financial/reconciliation export.

## 6. UX Assessment — Mobile UX 85 / Product 82

Exceptional state coverage (EmptyState ×15, ErrorState ×30, Skeleton/refresh ×30, toast ×41, haptics ×46, 266 `accessibilityLabel`s, 134 `hitSlop`s); idempotent payments with honest verification; revocable live-trip-share + SOS with an "I'm safe" stand-down; offline mutation queue; draft persistence across app-kill. The happy paths are complete and resilient. The gaps are high-leverage edges:
- 🔴 **Raw phone numbers exposed on calling** — `tracking/[id].tsx:1052` dials `tel:${runner.phone}` directly (masked-call is an unshipped TODO). Leaks a customer's personal number to a stranger. **Fix:** masked DID (Twilio/Telnyx) via `POST /bookings/{id}/call`; interim, restrict to active trips + never render the raw number.
- 🟠 **Dynamic Type disabled app-wide** — `_layout.tsx:66-74` `allowFontScaling=false`, while Appearance settings tell users to enlarge text via system settings (which now does nothing). Locks out low-vision users. **Fix:** remove the lock (or cap ~1.3×) + in-app text-size control + fix the copy.
- 🟠 **Hard login wall** — no guest/browse-before-signup; pricing/coverage invisible pre-account. Depresses top-of-funnel conversion. **Fix:** browse-only home, defer the sign-in wall to "Book."
- 🟠 **OTP resend locked 5 minutes** (`verify-otp.tsx:44`) — if the first SMS never arrives (common in PH), the user is stranded. **Fix:** 30–60s.
- 🟠 **In-app password reset unwired** — `forgot-password` dead-ends at "check your email"; `authService.resetPassword` has no caller/route/deep-link handler. Recovery depends on an external page that may not exist. **Fix:** build the deep-linked reset screen, or confirm the web fallback. *(Note: the backend `ForgotPasswordRequest` is a deliberate account-existence oracle — documented product choice — throttled.)*
- 🟠 **Runner completion may emit `'signature_placeholder'`** (`errand/[id].tsx:676`) — hollow proof-of-delivery evidence. *Verify on device.*
- 🟡 Notification permission never primed (raw OS ask); dark-mode stubbed (palette built, not wired); report-a-problem deep link inert; cards display-only (no vaulting); placeholder ToS/Privacy shipping (`LegalModal.tsx`); payment brand marks — GCash/GrabPay both a colored "G" (collide for color-blind users).

## 7. Performance Assessment — Backend 88 / Mobile 82

**Backend:** comprehensive composite indexing (incl. `idx_runner_profiles_online_status_lat`), universal eager-loading (no N+1 across booking/chat/wallet/feed), SWR caching, ETags, bounded pagination, sargable rewrites. One real risk:
- 🟡 **25s synchronous Xendit call on the booking-create path** ([PaymentService.php:45-47](errandguy-api/app/Services/PaymentService.php#L45)) — a gateway brownout at peak pins the FPM pool 25s each → 502 cascade. **[FIXED this session: tightened to 12s; circuit-breaker still recommended.]**

**Mobile:** proper virtualization, disciplined listener/timer cleanup, in-flight dedupe + micro-cache + conditional-GET. Polish left: row memoization (only 2 of the list rows are `React.memo`), pausing polling off-screen.

## 8. Security Assessment — 86/100

Verified *closed* (not assumed): no social-login `aud` bypass (this API has no OAuth *user* login), no IDOR (owner-scoped `{id}` endpoints), whitelisted mass-assignment, Xendit webhook verified with `hash_equals` + replay-dedup, all raw SQL bound, full header set (CSP `default-src 'none'`, HSTS, nosniff), env-driven CORS (no wildcard, `supports_credentials:false`), body-size/JSON caps, KYC docs now on a private disk behind gated serving. Remaining:
- 🟠 **Chat / booking / receipt photos on the PUBLIC disk, served unauthenticated** ([ChatController.php:130](errandguy-api/app/Http/Controllers/Chat/ChatController.php#L130), [RunnerErrandController.php:377,388](errandguy-api/app/Http/Controllers/Runner/RunnerErrandController.php#L377)) — the *same* PII-on-public-disk class just fixed for KYC, left inconsistent. Receipt photos reveal purchases; chat images are arbitrary user content. **Fix:** mirror the KYC remediation (private disk + participant-gated streaming route). *Not a quick win — mobile-display-coupled, like KYC.*
- 🟡 **Admin tokens inherited the 30-day global TTL** — a stolen admin bearer valid for a month. **[FIXED this session: 8h absolute expiry.]**
- 🟡 **Wallet-ledger endpoint serialized `gateway_ref`** (gateway internals) to the client. **[FIXED this session: `$hidden`.]**
- 🟡 Admin search uses leading-wildcard `LIKE '%term%'` (non-sargable) — low volume today.
- 🟢 No DB `CHECK (amount >= 0)` constraints — reconcile *detects* drift but doesn't *prevent* it.

## 9. Scalability & Reliability Assessment — 55/100

Correct prod drivers, external-call timeouts, idempotency, and inline safety backstops are real strengths. Ceilings:
- 🟠 **Single-server SPOF** — MySQL, Redis, Reverb, FPM, worker, scheduler on one box; Reverb multi-node exists but is off; no LB. One box = total outage.
- 🟠 **Redis is a correlated SPOF** — cache + queue + throttle + Reverb-scaling all target one Redis; if it's down, the RateLimiter (cache-backed) throws → **every API request 500s**. A `failover` cache store is defined but unused. **Fix:** select the failover store or catch limiter failures.
- 🟠 **No failed-job / worker-liveness alerting** — general queued work (refunds, notifications) can stall silently (no Horizon, no `queue:monitor`). **Fix:** schedule `queue:monitor` + a worker heartbeat alert.
- 🟡 No MySQL connection pooling; no Xendit retry despite a safe idempotency key **[retry recommended]**; DR is a logical dump (24h RPO), no PITR/binlog, no tested restore.

## 10. Maintainability Assessment — Backend solid / Mobile 61

Backend: clean schema (decimal money, FK/unique coverage, cast JSON), a self-maintaining lock arch-guard test suite, 565 tests green on **SQLite + MySQL 8**. Mobile: excellent infra, but **near-zero screen/hook/service test coverage** (23 test files cover only stores/utils/primitives; 56 screens + 24 hooks + 16 services untested; `collectCoverage:false`), **231 `any`** at the API boundary (zod is a dependency — unused for responses), and **god-screens** (`tracking/[id]` 2,875 LOC, `book/details` 2,564, `errand/[id]` 1,788). **Fix:** type the service layer with zod; add hook/service integration tests + a CI coverage floor; decompose the three god-screens into feature hooks.

## 11–13. Complete Gap List (severity · root cause · production-grade fix)

### 🔴 Critical
| # | Gap | Root cause | Fix |
|---|---|---|---|
| C1 | **No observability** — no error tracking/APM; Telescope is `require-dev`, deploy `--no-dev`. A prod 500 pages no one. | Telemetry never leaves the box. | `sentry/sentry-laravel` + `@sentry/react-native`; route `critical` logs to Slack. |
| C2 | **Mobile release-blocker** — `eas.json` prod env has `EXPO_PUBLIC_REVERB_KEY:"REPLACE_..."` + possibly wrong API host. | Un-swapped production config. | Set the real Reverb key + verified API URL; CI assert no env value contains `REPLACE_`. |
| C3 | **No backup before `migrate --force`** (deploy). | Irreversible step, no pre-migrate snapshot. | **[FIXED: `errandguy:backup-database` now runs before migrate in `deploy.sh`]**; set `DB_BACKUP_DISK=s3`. |
| C4 | **Raw phone-number exposure** on the call button. | Masked calling unshipped. | Masked DID; interim, hide the raw number. |

### 🟠 High
| # | Gap | Fix |
|---|---|---|
| H1 | Chat/booking/receipt photos on public disk, unauthenticated | Private disk + participant-gated route (reuse KYC pattern) |
| H2 | `store()` 515-line god-method; gateway charged post-commit | Extract `PaymentService::collectForBooking()` + `BookingCreationService` |
| H3 | Dispute resolution moves no money | `resolve()` → optional `WalletService::refund()`, ledgered to the dispute |
| H4 | Dashboard dispute-count blindspot | **[FIXED: count `open`+`escalated`]** |
| H5 | Dynamic Type disabled app-wide | Remove lock (or cap 1.3×) + in-app control + fix copy |
| H6 | Hard login wall (no guest) | Browse-before-signup; defer wall to "Book" |
| H7 | OTP resend locked 5 min | Reduce to 30–60s |
| H8 | In-app password reset unwired | Build deep-linked reset screen or confirm web fallback |
| H9 | Redis correlated SPOF (limiter 500s if down) | Select `failover` cache store / catch limiter failures |
| H10 | No failed-job/worker alerting | `queue:monitor` + worker heartbeat |
| H11 | Shallow `/up` health probe | **[FIXED: deep `/health` (DB+cache); wire an uptime monitor + `/health` in the deploy gate]** |
| H12 | Non-atomic deploy, no rollback | Forge zero-downtime/Envoyer; keep a `migrate:rollback` path |
| H13 | 231 `any` at mobile API boundary; god-screens; ~0 screen/hook test coverage | zod response schemas; decompose; hook/service tests + CI floor |
| H14 | Runner completion may emit placeholder signature | Wire real `SignaturePad` output; verify on device |

### 🟡 Medium
Response-envelope ~30% adoption · admin tokens 30-day TTL **[FIXED: 8h]** · wallet `gateway_ref` leak **[FIXED: `$hidden`]** · 25s Xendit timeout **[FIXED: 12s]** · admin-token idle-timeout · no tax/VAT/withholding · dark-mode stubbed · notification-permission never primed · placeholder ToS/Privacy · payment brand-mark collision · login enforces 8-char (legacy lockout) · silent referral failure on register · APP_DEBUG guard is log-only (make it gate the deploy) · same-box backup (`DB_BACKUP_DISK=s3`) · leading-wildcard admin search.

### 🟢 Low
No DB CHECK constraints on money · a few actor columns lack a `users` FK · scheduler runs `dispatch_sync` (throughput ceiling) · font meter can't distinguish Good/Strong · custom-scheme-only deep links (no universal links) · iOS push deferred.

## 14. Prioritized Roadmap

### Quick Wins (days) — *the starred items shipped this session*
- ⭐ Pre-migrate backup in `deploy.sh` (C3) · ⭐ deep `/health` (H11) · ⭐ dispute-count fix (H4) · ⭐ 8h admin tokens · ⭐ wallet `gateway_ref` hidden · ⭐ 12s Xendit timeout.
- **Wire Sentry** (backend + mobile) + route critical logs to Slack (C1) — *highest ROI remaining*.
- **Fix `eas.json` prod env** (C2) + CI `REPLACE_` assert.
- `DB_BACKUP_DISK=s3`; make the prod-config check gate the deploy; select the `failover` cache store (H9); `queue:monitor` alert (H10); Xendit `->retry()`.
- OTP resend 30–60s (H7); relax login validation; surface referral failure; fix the Dynamic-Type lock + copy (H5).

### High-Impact (weeks)
- **Masked calling** (C4) + move chat/booking/receipt photos to a private disk (H1).
- Guest/browse-before-signup (H6); in-app password reset (H8); wire the real completion signature (H14).
- Extract payment collection from `store()` (H2); wire dispute→refund (H3).
- Type the mobile service layer with zod + add hook/service tests + CI coverage floor; decompose the three god-screens (H13).
- Atomic/zero-downtime deploys + rollback path (H12); Laravel Pulse or Sentry Performance (APM).

### Long-Term (quarter+)
- Break the single-server SPOF: separate DB/Redis, multi-node Reverb behind an LB, connection pooling (ProxySQL).
- Managed DB **PITR** (binlog/snapshots) + a *tested* restore runbook.
- Tax/VAT + withholding + double-entry ledger + financial/reconciliation exports (compliance).
- Card vaulting, dark mode, gift cards; iOS push (APNs); universal links.
- Reconcile the parallel NestJS booking-create path with the promo per-user lock (if that backend goes live).

---

## Appendix — Implemented This Session (25 commits, `main`, all triple-checked on SQLite + MySQL 8)

**Money-safety:** payout-status money-loss, wallet reconciler, refund-orphan reaper, cash-settlement verified, idempotency, ledger, dedup-prune, dead-code removal. **Security/privacy:** PII log redaction, admin REST role authz + audit, admin-login lockout throttle, Filament bulk-delete role gates, **KYC → private disk + gated serving + migration command**, admin token 8h TTL, wallet `gateway_ref` hidden. **Reliability/concurrency:** scheduler hardening (worker-independent + onOneServer + bounded mutex), broadcast idempotency, FCM timeout, booking_number collision-safe, **SOS one-active-alert race**, **promo per-user TOCTOU** (both closed with row locks + two-connection proofs), PricingService crash guard, 12s Xendit timeout. **DevOps:** nightly DB-backup command + **pre-migrate backup in deploy**, deep `/health`, dispute-count fix, CI `curl --fail`, phpunit memory pin + MySQL-8 CI job. **Tests:** 565 green on both engines.
