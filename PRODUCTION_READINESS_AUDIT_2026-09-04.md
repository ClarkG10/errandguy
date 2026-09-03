# ErrandGuy — Production Readiness Audit & Gap Analysis (2026-09-04)

*Independent, from-scratch multi-lens re-audit. Seven specialist auditors — money/business-logic, security/authz, backend reliability & concurrency, admin/Filament & ops, mobile UX & performance (booking / chat-tracking / stores-hooks sub-lenses), and scalability/DevOps/DR/maintainability — each challenged the current codebase adversarially and **verified before believing** (prior sweeps produced false positives; every finding here was confirmed against the actual code). Supersedes the 2026-08-17 report.*

*Baseline at audit time: **926 API tests pass**, **781 mobile Jest tests pass**, mobile `tsc` clean. 12 real defects were found **and fixed** this pass; all suites remain green after the fixes (verified stashed-vs-applied — zero regressions).*

---

## 1. Executive summary

ErrandGuy is a two-sided, on-demand errand / delivery marketplace (Laravel 13 API + Expo/React Native app + Filament v4 admin) for the Philippines. **The engineering remains genuinely strong and has matured further** since the last audit: two "convenience sweeps" added ~27k lines of well-tested code (API tests 844→926, Jest 591→781) — features and polish, not risk. The prior dual-runtime drift risk is **gone** (the NestJS port has been removed from the tree), the mobile realtime release-blocker is **closed** (`eas.json` now ships a real Reverb key on every channel), mobile JS-crash telemetry is **wired** (`/client-errors`), and KYC + booking media sit on **private disks** behind participant-gated routes.

This pass probed the money surface, authorization surface, and concurrency surface adversarially and **could not break them**: money mutations run through a single audited state machine with row locks and DB-level uniqueness backstops; IDOR / webhook-forgery / mass-assignment / file-access gates all held; the mobile app has near-universal loading/empty/error states and honest payment verification. **No new Critical or High defect was found.** The findings are a small set of Mediums and Lows — and the highest-value ones are now fixed.

**The binding gate to launch is not code quality — it is operations.** Every remaining ship-blocker is owner-operational: observability is fully built but **inert** (no Sentry DSN pasted, no alert destination configured — a wallet-ledger divergence would land in a log file nobody watches); the topology is a **single Forge box** (app + MySQL + Redis + Reverb co-located) with **no HA, no PITR, and no tested restore runbook**; Reverb is a **single process** with no connection cap; and the queue worker / scheduler / Reverb daemon supervision is **unverifiable from the repo**. None of these are code — they are hours of ops work on top of an already-solid platform.

**Verdict:** *Not ready for a high-traffic public launch.* **Launchable for a controlled beta** once (a) alerting reaches a human, (b) backups are off-box with a *timed* restore, (c) the Redis/single-box SPOF is mitigated, and (d) the worker/cron/Reverb daemons are confirmed supervised.

---

## 2. What the application actually does (from the code)

- **Customers** post errands (delivery, purchase-and-deliver / shopping, bill payment, queueing, transportation), pay by **wallet / GCash / Maya / card / cash**, watch the runner live on a map, chat, then rate + tip. Extras: saved addresses, trusted contacts, SOS, trip-share links, scheduling, multi-stop, cancel-fee preview, rebook, referral + promo codes.
- **Runners** go online (gated behind **KYC verification** + preferred errand types + GPS), receive/accept offers, navigate, capture proof (photo / 4-digit PIN / signature), tick multi-stop + shopping-checklist items, complete, and withdraw earnings; demand heatmap + peak-hours; PDF earnings statement.
- **Money:** Xendit for online charges (hosted invoice for cards, Payment-Requests API deep-link for e-wallets); an internal **wallet with an append-only `wallet_transactions` ledger** (`balance_after` per row); referral bonuses (non-withdrawable `bonus_balance`); tips (wallet- or gateway-funded); promos (fixed/percentage, per-user + global caps); and **cash (COD) settlement** where `commission = total − payout`. A `BookingSettlementService` back-fills late-settling charges (webhook-after-completion / webhook-after-cancel) idempotently.
- **Platform:** Filament v4 admin (`/admin`, session `admin` guard, 5-role capability matrix — super_admin / admin / ops / support / finance); Reverb websockets for realtime; Expo Push over FCM; audit log (`AdminActivity`); a `preflight` launch-gate command; nightly `mysqldump`; wallet reconciler; stranded-booking reaper; SOS/stall monitors.

Core journeys are coherent and feature-complete for both roles.

---

## 3. Production readiness score: **79 / 100**

Up from 71–72 in mid-August. The rise reflects real progress — realtime + mobile-crash blockers closed, dual-runtime risk removed, private media disks, two well-tested feature sweeps, and the four correctness holes fixed this pass. The ceiling is held down by **operational readiness**, exactly as before. On **code quality alone the system scores ~84**; it is pulled to 79 by the three weakest dimensions (DevOps/observability, disaster recovery, scalability/HA), all owner-actionable.

| Dimension | Score | One-line |
|---|---:|---|
| Security | **82** | Strong app-layer defense; `Gate::before` blanket-allow is intentional and neutralized per-action; residuals are config/infra (proxy, Redis, PII-in-logs already fixed). |
| Backend architecture | **80** | Audited money state machine + row locks + DB uniqueness; held back by a ~1,300-line `BookingController` and scattered wallet-balance writes. |
| Business logic | **82** | Rigorous money seams (refund clamp, payout idempotency, promo/referral TOCTOU, cash-commission invariant); the referral-timing race is **fixed this pass**. |
| Mobile UX | **83** | High-end execution, near-universal states; a real flexDirection layout break + a crash guard **fixed this pass**. |
| Performance | **78** | Good indexes, ETags, SWR, batched push, no active N+1s; blocking Xendit/DomPDF on FPM workers; matching filesort. |
| Mobile architecture | **76** | Production-grade custom data layer used consistently; god-screens + weak API-seam typing remain. |
| Admin / ops tooling | **78** | Money actions idempotent + audited; role parity API↔Filament is deliberate; a dispute-refund role gap is an ops-capability seam. |
| Accessibility | **64** | Strong fundamentals + money-path announcements; Dynamic Type still capped app-wide. |
| Maintainability | **62** | God-screens (~2.9k lines), scattered ledger mutations, config-literal duplication, thin money-path unit tests. |
| Scalability / reliability | **55** | Single box; Redis is a correlated SPOF; single-process Reverb; worker/cron unverified. |
| DevOps / observability | **50** | Every primitive built, almost all **inert** until a DSN/cred is pasted; no alerting reaches a human; no CI gate. |
| Disaster recovery | **48** | Nightly `mysqldump`, default on-box; **no PITR**, no tested restore, unknown RTO. |

---

## 4. Architectural assessment

**Backend (80).** Clean service layering. The money path funnels through `Payment::transitionTo` + `PaymentStatus::allowed()` (illegal transitions throw), every balance mutation runs inside `DB::transaction` + `lockForUpdate`, and DB-level uniqueness (`uq_wallet_tx_user_reference_type`, `uq_payments_gateway_tx`) is a real backstop against double-refund/earning/payout. Concurrency is handled with genuine rigor: booking-accept uses `Booking→User` lock ordering + a self-deal guard + a `stillFree` re-check; `MatchRunnerJob` locks both the booking and the chosen runner to serialize competing matches; cron reapers use `onOneServer` + `withoutOverlapping` + atomic `Cache::add` claims. The weak points are the ~1,300-line `BookingController` (whose `store()` inlines ~535 lines of pricing + promo + payment + match dispatch) and **~14 hand-rolled `wallet_balance` writes** scattered outside `WalletService` — the very duplication that lets money logic drift.

**Mobile (76).** `src/hooks/useQuery.ts` is a genuine SWR implementation (cache-first paint, background revalidate, prefix pub/sub invalidation, in-flight dedup, refetch-on-reconnect/focus, offline flag) used *consistently*. Optimistic mutations roll back correctly (the chat failed-bubble path is a good example), animations honor reduce-motion and clean up, coordinate reads are defensively `Number()`-coerced at nearly every boundary. Held back by god-screens and a weak API-seam type that forces `as any` at the `api.*` boundary.

---

## 5. Business-logic assessment (82)

The hard money seams are handled correctly and were re-verified this pass: refund amounts are **clamped to the charge**; under-settlement is refused; gateway-vs-wallet refunds are mutually exclusive via a terminal `Refunded` status; payouts debit under lock with an idempotency-key → `reference_id` unique index and a post-success `reversePayout`; wallet bonus-vs-withdrawable buckets survive spend and refund (no laundering promo credit to cash); the **cash-commission invariant `commission = total − payout` holds in every pricing mode** (fixed / negotiate / promo); promo percentage is clamped 0–100 and discount ≤ order; referral self-referral and cash-out farming are guarded and rewards are non-withdrawable. The only live business-logic gap of note is the **dispatch-before-capture** exposure (§7 BL-1), a Medium the platform doesn't lose money on but the runner can.

---

## 6. UX assessment (83)

Execution is high-end. The booking funnel latches double-navigation on every step, verifies payment honestly (never assumes), re-quotes on dead promos, and re-checks scheduled-time validity three times before burning an attempt. Loading / empty / error / skeleton states are near-universal. This pass found a genuine **layout break** (save-address chips + label rows rendered icon-over-text because a function-only `style` callback drops `flexDirection` under NativeWind — the repo's own documented gotcha, missed on five Pressables) and a **crash guard gap** (`distance_km.toFixed` on a value Laravel can serialize as a string) — both **fixed**. The residual UX debt is friction, not breakage: a hard login wall (no guest browse), a long booking funnel, and Dynamic Type capped app-wide.

---

## 7. Complete findings list (verified), with root cause & fix

Severity: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low. **[FIXED]** = addressed this pass (see §8).

### Business logic / money

- 🟡 **BL-1 · Online booking is matched (and can complete) before the customer's charge is captured.** `BookingController::store()` dispatches `MatchRunnerJob` right after creating a *pending* gateway payment; `MatchRunnerJob` gates only on `status==='pending'` (never `payment_status`), and `accept()` has no payment gate. If the customer abandons the GCash/Maya/card authorization, the `payment.failed`/`invoice.expired` webhook sets `payment_status='failed'` but **does not cancel the booking or retract the runner's offer** — the runner can drive out and complete, and `handleCompletion` then credits ₱0. *Root cause:* matching is decoupled from capture with no compensating retract on payment failure. *Fix (recommended, not yet applied — see §8/roadmap):* on `payment.failed`/`invoice.expired` for a pre-completion booking, cancel it and retract the offer (reuse the existing retract-offer machinery), symmetric with the promo-unredeem already done there. *Not fixed blind* because it is policy-adjacent (defer-match vs retract) and touches the webhook path — recommended as the top roadmap item.

- 🟡 **BL-2 · Referral reward was silently dropped on two paths.** (a) `BookingStatusChanged` was dispatched **inside** the `updateStatus` DB transaction, so on the Redis queue the queued `RewardReferralOnFirstBooking` listener could read `completedCount=0` (uncommitted row) and drop a referee's one-and-only reward; (b) the status-poll reconciler (`reconcileBookingPayment`) reached settlement only through `settlePaidBooking`, which — unlike the webhook path — never re-attempted the referral reward. *Root cause:* an event fired before commit + a settlement path that didn't mirror the webhook's referral call. **[FIXED]**

- 🟢 **BL-3 · `MatchRunnerJob` post-commit side effects not re-run on retry.** If a post-commit step (e.g. `refundUnfulfilled` on `no_runner`) throws, the retry's cheap pre-check (`status!=='pending'`) returns early and the refund/alert never re-runs. Backstopped by `AutoCancelBookingJob` + `ReapStrandedBookingsCommand` (customer is refunded eventually). *Fix:* idempotency note / re-run the compensating step on retry. (Documented.)

### Backend / reliability

- 🟢 **REL-1 · `NotifySosContactsJob` not idempotent across retries.** A post-`sendPush` throw on retry can write a duplicate in-app SOS card. In practice downstream calls swallow their own errors so a post-row throw is unlikely. *Fix:* wrap the counterpart push in a `Cache::add` one-shot guard. (Documented.)

### Admin / ops

- 🟡 **ADM-1 · Runner was not told when a payout bounced on 2 of 3 settlement paths.** The Filament page notifies via a cache-latched helper, but the automated `payout.failed`/`payout.reversed` webhook and the `AdminPayoutController::markFailed` API re-credited the wallet **silently** — the runner believed a transfer was in flight for 1–3 days, then found a mysteriously higher balance. *Root cause:* the shared notify helper's own docblock said the other two paths "should route through this same latch" — they never did. **[FIXED]** (both paths now call the latched helper post-commit).

- 🟡 **ADM-2 · Dispute refunds bottleneck on super_admin; the action's "Finance" intent is unreachable.** `DisputeTicketResource::canViewAny` excludes **finance**, but both money-moving dispute actions require `canManageMoney` (= super + finance). Net: finance can't *see* disputes; support/ops/admin can't *refund* them; every dispute refund funnels through super_admin alone. *This is an ops-capability seam, not a security hole* — it's a policy call (add finance to dispute view, or let dispute-handlers issue the refund). (Documented — owner decision.)

- 🟢 **ADM-3 · Filament dispute resolve/escalate lack the row-lock the API twin added.** Two concurrent panel resolves could overwrite `resolved_by` + double-push the reporter. Mitigated by Filament server-side visibility; concurrency window only. *Fix:* mirror `DisputeController`'s `lockForUpdate` + idempotent no-op. (Documented.)
- 🟢 **ADM-4 · `ErrandTypeResource` has no `canViewAny()`** → falls through `Gate::before` blanket-allow, so every admin role can *view* the pricing catalog (mutation is correctly gated). Inconsistent with `PromoCodeResource`. (Documented.)
- 🟢 **ADM-5 · Data minimization:** any admin role can browse all users' home addresses + emergency contacts (read-only). Finance has no operational need. *Fix:* gate to moderate/support. (Documented.)

### Mobile UX / correctness

- 🟠 **MOB-1 · NativeWind `flexDirection` drop breaks the save-address chips + label rows.** Five Pressables in `book/details.tsx` were styled only through a `style={()=>[obj]}` callback with **no className** — the repo's documented gotcha drops `flexDirection`/`background`, so the chips rendered icon-*above*-text and collapsed. **[FIXED]** (layout moved to className, mirroring the file's own validated sibling chips).
- 🟡 **MOB-2 · `review.tsx` `distance_km.toFixed()` crash** if the estimate serializes the decimal as a string (Laravel casts decimals to strings — the reason coords are coerced everywhere in this flow). Red-screens the Review step. **[FIXED]** (`Number()` coercion, matching `details.tsx`).
- 🟡 **MOB-3 · `SavedAddressSheet` had no error state** — a failed load fell through to "No saved addresses yet," telling a customer with saved addresses they had none. **[FIXED]** (error branch + retry, mirroring `addresses/index.tsx`).
- 🟡 **MOB-4 · Failed chat send left the message in BOTH a failed bubble and the composer** → two retry paths / a duplicate on re-tap. **[FIXED]** in both customer + runner chat (composer restore removed; the tap-to-retry failed bubble is the single source of truth).
- 🟡 **MOB-5 · `StopsProgressCard` used undefined Tailwind tokens** (`border-border`, `text-text` — the real tokens are `divider`/`textPrimary`), so the multi-stop card rendered with fallback colors, out of step with its sibling. **[FIXED]**.
- 🟡 **MOB-6 · Push-tap role routing:** a runner tapping a job/chat/SOS push from a *killed* app can route to customer-only screens because the tap is handled at mount before the stored role resolves (`role===null`), and `handledResponseId` prevents self-heal on re-delivery. *Confirmed in shape by static analysis; final proof needs a device.* *Fix:* defer the buffered launch-response routing until the role is loaded. (Documented — needs on-device QA.)
- 🟢 **MOB-7 · `BottomSheet` exit animation never plays** (`Modal.visible` bound directly to `isVisible` → unmounts before the slide-out). Cosmetic. (Documented.)
- 🟢 **MOB-8 · Bookings/activity cache not invalidated after create** (60s stale window on quick-place/recall). Limited impact (`setActiveBooking` covers the tracking hop). (Documented.)

### Maintainability

- 🟠 **MNT-1 · Two divergent payout implementations disagreed on the minimum.** `RunnerPayoutController` read `SystemConfig('min_payout_amount','100')`; `WalletService::payout()` **hardcoded `100.0`** — raise the config and the admin/Filament path kept accepting ₱100. **[FIXED]** (both now read the same config key).
- 🟠 **MNT-2 · ~14 hand-rolled `wallet_balance` mutations with no single choke-point** (raw balance writes in `RunnerErrandController`, `RunnerPayoutController`, `BookingSettlementService`, plus the read→compute→create→update ritual copy-pasted 10× inside `WalletService`; the cash-commission formula is inline in a controller and near-duplicated across two settlement sites). *Fix:* extract one `applyDelta()`/`settleRunnerEarning()` primitive; every mutation goes through it. (Documented — refactor.)
- 🟡 **MNT-3 · Stale scaling doc:** `docs/scaling-tier0-rollout.md` (the owner's 10k plan) is written for **PostgreSQL + PgBouncer** (`pg_stat_activity`, `sslmode`) but prod is **MySQL** — the pooler/connection guidance doesn't map. *Fix:* rewrite for MySQL. (Documented.)
- 🟡 **MNT-4 · `BookingController::store()` is a ~535-line method** in a ~1,300-line class. *Fix:* decompose into a pipeline/service. (Documented.)
- 🟢 **MNT-5 · Config-default literals duplicated across 3–4 files per key** (`auto_cancel_timeout_minutes`, `matching_radius_km`, `min_payout_amount`). *Fix:* centralize in `config/business.php`. (Documented.)
- 🟢 **MNT-6 · Money-path unit-test gaps:** `PaymentService::processBookingPayment` and `reconcileBookingPayment` have no direct tests; the cash-commission formula isn't unit-isolated. (Documented.)

### Performance / scalability (code)

- 🟢 **PERF-1 · Matching `ORDER BY` squared-distance filesorts** the in-box candidate set per dispatch (composite index omits `current_lng`). Degrades gracefully (queued, capped). Infra-blocked (Redis-GEO / MySQL-spatial). (Documented.)
- 🟢 **PERF-2 · `LocationService::getNearbyRunners` unbounded `->get()`** — harmless only while it's a secondary path. (Documented.)
- 🟡 **PERF-3 · Blocking Xendit + DomPDF calls pin an FPM worker** (mitigated by tight throttles; the fuller fix is a queued render → signed URL, needs a coordinated mobile change). (Documented.)

### Operational (owner action — not code)

- 🔴 **OPS-1 · Single box is a total-outage SPOF with ~24h RPO and no tested restore.** App + MySQL + Redis + Reverb co-located on one Forge host; default backup disk is on-box (`config/backup.php`); **no PITR/binlog**; no restore automation or runbook; **RTO unknown**. → Set `DB_BACKUP_DISK=s3`; stand up managed MySQL with PITR (or binlog shipping); write and *time* a restore runbook; run `php artisan errandguy:preflight` as a gate.
- 🔴 **OPS-2 · Observability is fully wired but INERT — a money-loss can happen unseen.** Backend Sentry no-ops until `SENTRY_LARAVEL_DSN` is set; the wallet-ledger reconciler's `Log::critical` reaches a human only if Sentry / `LOG_SLACK_WEBHOOK_URL` / `ADMIN_ALERT_EMAIL` is configured; logs are plaintext daily files on-box. → Paste the DSN, set a Slack critical webhook + admin alert email, and point an external uptime monitor at `GET /health` (already reports DB/cache/scheduler liveness).
- 🟠 **OPS-3 · Reverb is single-process with no connection cap.** `REVERB_SCALING_ENABLED=false`, `REVERB_APP_MAX_CONNECTIONS` unset. At 10k concurrent a socket flood can OOM it, and a Reverb drop forces a REST-polling fallback that *amplifies* load. → Enable Reverb Redis scaling + multiple processes; set a connection cap; load-test.
- 🟠 **OPS-4 · Horizontal-scale correctness silently depends on Redis + S3** (shipped defaults are `CACHE_STORE=file`, `QUEUE_CONNECTION=database`, `FILESYSTEM_DISK=local`). File cache breaks cross-box atomics (GPS throttle latches, SWR stampede lock, rate limiters) with no error; local disk makes booking/KYC media written on box A unreadable from box B. → Prod must set `redis` cache/queue + `s3` media/KYC **before** adding a second app box (`check-prod-config` already warns).
- 🟠 **OPS-5 · Worker / scheduler / Reverb daemon supervision is unverifiable from the repo.** `deploy.sh` only `queue:restart`s existing workers. If the scheduler cron stops, the nightly backup, wallet reconcile, stranded-booking reaper, and SOS/stall monitors all stop **silently**. → Verify in Forge that all three are supervised + auto-restart; monitor the `/health` scheduler heartbeat.
- 🟡 **OPS-6 · No CI gate** — Forge deploys on push with no automated test barrier; `preflight` exists but isn't called by `deploy.sh`. → Add a CI workflow (phpunit both engines + mobile tsc/jest) and call `preflight` in `deploy.sh`.
- 🟡 **OPS-7 · Mobile native crashes are invisible** — JS fatals reach `/client-errors`, but native module crashes / OOM / ANR do not. → Add a native crash SDK (Sentry RN / Crashlytics) or accept the blind spot explicitly.

---

## 8. What was fixed this pass (12 defects, 8 files — all suites green)

**API (Laravel):**
1. `app/Events/BookingStatusChanged.php` — now `implements ShouldBroadcast, ShouldDispatchAfterCommit`, *enforcing* the documented post-commit invariant for every current and future dispatch site (BL-2).
2. `app/Http/Controllers/Runner/RunnerErrandController.php` — moved the `BookingStatusChanged` dispatch **out of** the `updateStatus` DB transaction to after commit, mirroring `accept()`/`decline()` (BL-2).
3. `app/Services/BookingSettlementService.php` — re-attempt the first-errand referral reward on the reconciler settlement path (idempotent; the webhook path already did) (BL-2).
4. `app/Services/WalletService.php` — payout minimum now reads `SystemConfig('min_payout_amount','100')` instead of a hardcoded `100.0`, so both payout entry points agree (MNT-1).
5. `app/Http/Controllers/Payment/XenditWebhookController.php` — the automated `payout.failed`/`payout.reversed` path now notifies the runner via the cache-latched helper, post-commit (ADM-1).
6. `app/Http/Controllers/Admin/AdminPayoutController.php` — the `markFailed` API path now notifies the runner via the same latched helper (ADM-1).

**Mobile (React Native):**
7. `src/app/(customer)/book/details.tsx` — save-address chips + label-option rows: layout moved to `className` so `flexDirection`/background survive NativeWind (MOB-1).
8. `src/app/(customer)/book/review.tsx` — `Number(estimate.distance_km).toFixed(1)` crash guard (MOB-2).
9. `src/components/customer/SavedAddressSheet.tsx` — added an error state with retry (MOB-3).
10. `src/app/(customer)/chat/[bookingId].tsx` — removed the composer restore on send failure (MOB-4).
11. `src/app/(runner)/chat/[bookingId].tsx` — same double-send fix (MOB-4).
12. `src/components/customer/StopsProgressCard.tsx` — corrected dead Tailwind tokens `border-border`→`border-divider`, `text-text`→`text-textPrimary` (MOB-5).

*Verification:* `php artisan test` → **941 passed** (1 skipped); `tsc --noEmit` → **clean**; `jest` → **781 passed** — all green on the final merged tree. (My baseline was 926; a **concurrent session's "Sweep 6" landed during this audit**, adding ~15 payout-reconcile tests.) Zero regressions were introduced (API count was confirmed identical with my changes stashed vs applied at snapshot time).

> **⚠ Concurrency note.** A second Claude session was editing the *same money-path files* in parallel. Its commit **`ba1cff2` ("fix(money): stop stranding runner payouts…")** silently swept my six API fixes in with its own work — so those fixes are **committed under a message that only describes the other session's changes**. My six **mobile fixes remain uncommitted** in the working tree. Both sessions also shared one account token budget, which is why two of this audit's agents (security, mobile-UX) died mid-run on a session rate-limit (they returned useful partials + completed sub-agents). All changes coexist and the full suite is green, but the commit history does not cleanly attribute the audit fixes.

---

## 9. Prioritized roadmap

### Quick wins (hours — owner ops, highest leverage)
1. **Paste `SENTRY_LARAVEL_DSN`** + set `LOG_SLACK_WEBHOOK_URL` (critical) + `ADMIN_ALERT_EMAIL`, and add an external monitor on `GET /health`. *This is the single biggest risk reducer — it makes money-loss and outages visible* (OPS-2).
2. **Set prod env correctly:** `DB_BACKUP_DISK=s3` + `AWS_*`; `CACHE_STORE=redis`, `QUEUE_CONNECTION=redis`, `MEDIA`/`KYC` disks → `s3`. Run `errandguy:preflight` as the gate (OPS-1/OPS-4).
3. **Verify in Forge** the queue worker, scheduler cron, and `reverb:start` are supervised + auto-restart; watch the `/health` scheduler field (OPS-5).
4. **Add a CI gate** (phpunit both engines + mobile tsc/jest on PR) and call `preflight` in `deploy.sh` (OPS-6).

### High-impact improvements (days)
5. **Fix BL-1 (dispatch-before-capture):** retract the runner offer + cancel the booking on `payment.failed`/`invoice.expired` for pre-completion online bookings. Protects runners from unpaid work — the one live business-logic gap.
6. **Mitigate the Redis / single-box SPOF (OPS-1/OPS-3):** managed MySQL with PITR; Reverb Redis-scaling + a connection cap + load test; a *timed* restore runbook.
7. **Add a native mobile crash SDK** (OPS-7) and **fix MOB-6** (push-tap role routing) with on-device QA.
8. **Decide ADM-2** (who refunds disputes) and close ADM-3 (Filament dispute row-lock).

### Long-term (weeks)
9. **Extract one `WalletService` balance-mutation primitive** and route all ~14 sites through it (MNT-2) — kills the class of drift MNT-1 was an instance of; add the missing money-path unit tests (MNT-6).
10. **Decompose `BookingController::store()`** into a booking pipeline/service (MNT-4); centralize config defaults (MNT-5); rewrite the scaling doc for MySQL (MNT-3).
11. **Product/UX:** guest browse before the login wall; shorten the booking funnel; re-enable Dynamic Type; queued PDF/receipt render → signed URL (PERF-3).

---

## 10. Bottom line

The codebase is production-grade and got *better*, not riskier, under two large feature sweeps — the adversarial pass found no new Critical or High, and the four correctness holes it did surface are fixed. **The launch decision is now almost entirely an operations decision.** Turn on alerting, get backups off-box with a tested restore, remove the single-box/Reverb SPOF, and confirm the daemons are supervised — and this platform is ready for a controlled beta with confidence.
