# ErrandGuy — Production Readiness Audit & Gap Analysis (2026-08-17)

*Independent multi-lens re-audit — 6 specialist auditors (backend/money, security, performance/scale/reliability, mobile architecture, mobile UX/product/a11y, DevOps/SRE), each challenging the current codebase from scratch and verifying (not trusting) the recently-shipped Sentry + private-media hardening. Supersedes the 2026-08-13 report.*

---

## 1. Executive summary

ErrandGuy is a two-sided, on-demand errand/delivery marketplace (Laravel 13 API + Expo/React Native app) for the Philippines. **The engineering is genuinely strong — well above the norm for a marketplace at this stage.** Money mutations run through a single audited state machine with row locks and DB-level integrity constraints; IDOR, webhook verification, mass-assignment, and file-access gates all held up under adversarial probing; the mobile app has near-universal loading/empty/error states, honest payment verification, and a production-grade custom data layer.

**The gate to launch is not code quality — it is operations and a small number of real defects.** Every serious remaining item is one of: (a) an *un-activated* operational control (Sentry has no DSN, backups default on-box, no alerting reaches a human, deploy is non-atomic), (b) a *mobile release blocker* (`eas.json` ships a placeholder Reverb key → realtime dead on every install; no crash telemetry), or (c) a handful of correctness/logic holes. This pass found and **fixed the most serious code defect** — a money-loss bug where `rebook()` produced free errands (see §11/§14).

**Verdict:** *Not ready for a high-traffic public launch.* **Launchable for a controlled beta** once the mobile `eas.json` key is fixed, observability + alerting + off-site backups are switched on, and the Redis-SPOF degradation is addressed. Most of that is hours of ops work on top of an already-solid codebase.

---

## 2. What the application actually does (from the code)

- **Customers** post errands (delivery, shopping, bill payment, queueing, transportation), pay by wallet / GCash / Maya / card / cash, watch the runner live on a map, chat, then rate + tip.
- **Runners** go online (gated behind KYC verification + preferred-type + GPS), receive/accept offers, navigate, capture proof (photo / PIN / signature), complete, and withdraw earnings.
- **Money:** Xendit for online charges + a wallet with an append-only `wallet_transactions` ledger (`balance_after` per row), referral bonuses (non-withdrawable), tips, promos, and cash settlement (commission = `total − payout`).
- **Platform:** Filament v4 admin (`/admin`, session `admin` guard, capability matrix), Reverb websockets for realtime, Expo Push over FCM, KYC + booking media on private disks behind participant-gated routes, Sentry wired (inert until a DSN is set).

Core journeys are coherent and feature-complete: dual-role flows, live tracking, chat, ratings, tips, referrals, scheduling, multi-stop, cancel-fee preview, trip sharing, SOS.

---

## 3. Production readiness score: **71 / 100**

The number is dominated by **operational readiness, not code**. On code quality alone the system would score low-80s; it is pulled down by the two weakest dimensions (DevOps/observability 50, scalability/reliability 55) and the mobile release blocker.

| Dimension | Score | One-line |
|---|---:|---|
| Security | **80** | Strong app-layer defense; residual = PII-in-logs (now fixed), proxy/Redis config, fragile `Gate::before`. |
| Backend architecture | **78** | Audited money state machine + locking; held back by a ~1,200-line `BookingController`. |
| Performance | **77** | Good indexes, ETags, SWR, no active N+1s; blocking Xendit/DomPDF on FPM workers. |
| Mobile UX | **82** | High-end execution, near-universal states; friction at first-run + long booking funnel. |
| Product | **74** | Feature-complete; hard login wall, non-functional SOS→contacts, unshipped masked calling. |
| Mobile architecture | **74** | Production-grade data layer used consistently; god-screens + weak API-seam typing. |
| Business logic | **71 → higher** | Rigorous money seams; the one critical hole (`rebook`) is **fixed this pass**. |
| Accessibility | **62** | Strong fundamentals, but Dynamic Type disabled app-wide caps the ceiling. |
| Mobile maintainability | **57** | 2.9k-line god-screens, ~231 `any`, ~0 screen/hook tests. |
| Scalability / reliability | **55** | Single box; Redis is a correlated SPOF; worker/cron unverified. |
| DevOps / observability | **50** | Every primitive built, almost all inert/unactivated; no alerting to a human. |

---

## 4. Architecture assessment

**Backend (78).** Clean service layering; the money path funnels through `Payment::transitionTo` + `PaymentStatus::allowed()` (illegal transitions throw), every balance mutation runs inside `DB::transaction` + `lockForUpdate` (all 15 sites audited), and DB-level uniqueness (`uq_wallet_tx_user_reference_type`, `uq_payments_gateway_tx`) is a real backstop against double-refund/earning/payout. The weak point is `BookingController` (~1,200 lines) whose fat `store()` inlines pricing + promo + payment + matching — the very duplication that let `rebook()` drift into a payment-less clone.

**Mobile (74).** `src/hooks/useQuery.ts` is a genuine SWR implementation (cache-first paint, background revalidate, prefix pub/sub invalidation, in-flight dedup, refetch-on-reconnect/focus, offline flag) and — critically — used *consistently* (35 files, near-zero ad-hoc fetch). Layered auth-gating, a well-designed OTA gate, an offline mutation queue, and error boundaries are all correctly structured. Held back by god-screens (below) and a weak API-seam type (`ExtraConfig` never applied to `api.*` → ~48 `as any`).

---

## 5. Business logic assessment (71)

The hard money seams are handled with real rigor: late/self-healing settlement, refund bucket-splitting, idempotent tips/payouts, the cash-commission invariant (correct in every pricing mode incl. negotiate), promo TOCTOU, and referral cash-out farming all closed. The score was dragged down by **two live core-flow holes that let a runner work for free** — `rebook()` (🔴, **fixed this pass**) and online bookings dispatching runners before payment capture (🟠, see §11 H-B).

---

## 6. UX assessment (UX 82 / Product 74 / A11y 62)

Execution quality is high-end: microcopy, haptics, motion, feedback, skeletons, honest empty states, and screen-reader announcements are better than most shipping marketplaces; booking drafts + in-flight payments survive an app kill. Gaps: **Dynamic Type disabled app-wide** (`_layout.tsx:66-74` — a categorical a11y failure), **SOS→contacts marketed but inert**, **raw phone numbers** (masked calling unshipped, both sides), a **hard login wall / no guest funnel**, a **5-minute OTP resend** cooldown, a **6-stop booking funnel**, and **icon-only tab bars**.

---

## 7. Performance assessment (77)

Synchronous request paths are well-built: composite indexes on nearly every hot filter/sort/join, pagination or hard caps on every list, ETag 304s on the polled endpoints (track/chat/feeds), SWR catalog cache, denormalized runner position, and aggressive write-throttling of the two dominant write paths (GPS pings, `last_active_at`). **No active N+1s on the audited hot paths.** Costs to fix: blocking Xendit HTTP (≤12s) and inline DomPDF (≤500 items) on FPM workers, a latent `$appends` lazy-load on `WalletTransaction`, and (now fixed) a missing `payments.status` index + an unthrottled receipt-PDF route.

---

## 8. Security assessment (80)

**No confirmed 🔴 in committed code.** Verified clean under probing: IDOR (chat/payments/wallet/notifications/support/runner-errands all ownership-scoped), Xendit webhook (timing-safe token + replay dedup + under-settlement guard + idempotent handlers), file gates (regex-locked, path-traversal-blocked, participant/admin-only, fixed disk), Sentry PII-safety, admin auth (8h TTL, capability matrix), OTP (bcrypt-hashed, throttled, code never logged), mass-assignment (`$fillable` + validated whitelists), strict CSP/HSTS/CORS. The memory-flagged social-login `aud` bypass is **absent** (no OAuth sign-in exists). Residual: **PII in log files** (H1, **fixed this pass**), `TRUSTED_PROXIES`/Redis are deploy-config dependencies (H2/H3), and the blanket `Gate::before` admin-allow (H4) is fragile and leaks a few ungated Filament surfaces.

---

## 9. Scalability / reliability assessment (55) — the gating dimension

Everything runs on one Forge box and the failure modes are severe and **correlated**: Redis backs cache + queue + session-throttle + rate-limiter + presence, so its loss 500s the *entire* authenticated API at once (the `failover` cache store exists but is mis-composed `[database, array]` and unused). The queue worker and scheduler cron are unverified out-of-repo dependencies whose silent absence kills push, realtime, negotiate matching, **SOS contact fan-out**, *and* the money/safety backstops — with no alerting on their absence. Reverb is a single-process websocket bottleneck with horizontal scaling switched off. Strong compensating controls exist (scheduler-based money/safety reapers run inline via `dispatch_sync`, durable idempotency, webhook dedup + row locks, deep health probe) — but several depend on the very cron nobody verifies.

---

## 10. Maintainability assessment (backend good / mobile 57)

Backend is well-documented and consistent. Mobile is dragged down by: **six screens over 1,000 lines** (tracking `[id].tsx` **2,875**, book/details **2,563**, runner errand **1,788**), **~231 `any`** concentrated at the service/API seam, and **~0 screen/hook/service tests** (the crown-jewel `useQuery`, `usePaymentVerification`, `useChat` all untested) — so the highest-churn code is both hardest to change and least protected.

---

## 11. Complete gap list — with root cause + production-grade fix

Severity: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low. Items marked **[FIXED 2026-08-17]** were remediated in this pass (§14).

### 🔴 Critical
| # | Gap | Root cause | Fix |
|---|---|---|---|
| C-money | **`rebook()` created an uncharged, un-payable booking that dispatched a runner → errand done for free** | `rebook()` was a partial copy of `store()` that never got the payment block; no pay-for-existing-booking path exists. | **[FIXED 2026-08-17]** rebook now returns a prefill for the client to re-submit through `store()` (the single audited charge+match path); creates/dispatches nothing. |
| C-eas | **`eas.json` production build ships placeholder `EXPO_PUBLIC_REVERB_KEY` + unverified `api.errandguy.app`** → realtime (chat, tracking, offers, notifications) dead on 100% of installs | Prod env block scaffolded, never filled. | Set the real prod Reverb key (EAS secret) + confirm DNS/cert; add a build assert that fails on any `REPLACE_WITH`. **(mobile — needs a device build)** |
| C-mobcrash | **No mobile crash/error telemetry** — every crash/rejection ends in `console.error`, invisible in prod | No remote sink ever installed. | Add `@sentry/react-native`, init before `installErrorLogging`, upload Hermes source maps per EAS build, tag releases. **(mobile — needs native rebuild)** |
| C-alert | **No alerting reaches a human anywhere** — even with a Sentry DSN, no rule pages anyone; nothing watches `failed_jobs` | Observability built as detective controls with no notification layer. | **[PARTIALLY FIXED 2026-08-17]** `Queue::failing` now raises an admin alert + CRITICAL log on failed jobs; `/health` exposes scheduler staleness. REMAINING (ops): Sentry alert rules → Slack/email; uptime monitor → paging; route the CRITICAL logs to Sentry once the DSN is set. |
| C-redis | **Redis correlated SPOF** — throttle + `EnsureUserActive` touch cache every request; Redis down = whole authed API 500s | cache+queue+session-throttle+limiter+presence all on one Redis, no degradation. | **[PARTIALLY FIXED 2026-08-17]** `EnsureUserActive` presence write now fails open; the `failover` cache store recomposed redis→database→array. REMAINING: set `CACHE_STORE=failover` in prod (env) so the rate limiter also degrades; managed Redis HA. |
| C-backup | **Single-server SPOF; backups default on-box (`DB_BACKUP_DISK=local`), no PITR** | Off-site is opt-in via an off-repo env var; no binlog. | Set `DB_BACKUP_DISK=s3` + `AWS_*` (now in the prod template), enable MySQL binlog/PITR, monthly restore drill. **(ops)** |
| C-worker | **Queue worker + scheduler cron unverified/unmonitored** → silent loss of push, realtime, SOS fan-out, money/safety reapers | Liveness assumed, not enforced or observed. | **[PARTIALLY FIXED 2026-08-17]** `Queue::failing` now logs CRITICAL + raises an admin alert on any permanently-failed job; a scheduler heartbeat surfaces `scheduler: stale` in `GET /health` (dead-man's-switch). REMAINING: confirm the Forge daemons + point an uptime monitor at `/health` with a paging destination. **(ops)** |

### 🟠 High
| # | Gap | Fix |
|---|---|---|
| H-A | **PII (phone/email/identifier) written to plaintext log files** (Login/OTP/PasswordReset) — CWE-532 | **[FIXED 2026-08-17]** dropped raw phone/email/identifier from those log contexts (kept ip/channel/user_found/error). |
| H-B | **Online bookings dispatch runners *before* payment capture**, with no never-paid guard | Defer `MatchRunnerJob` for non-wallet/non-cash until `payment.succeeded`, or block runner status progression past `accepted` while `payment_status IN (pending,processing)`. |
| H-C | **Broadcast on the sync create path could 500 a committed booking** (`IncomingRequest::dispatch`, re-thrown by the outer catch) | **[FIXED 2026-08-17]** wrapped in try/catch (log + swallow), mirroring the guarded location broadcast. |
| H-D | **Deploy is non-atomic, no maintenance window, no rollback** (in-place `git pull`) | `php artisan down/up` around migrate; move to atomic releases (Envoyer/Deployer); keep the pre-migrate backup. **(ops)** |
| H-E | **`Gate::before` blanket-allows every AdminUser** — new Filament resources default to full access | **[PARTIALLY FIXED 2026-08-17]** revenue widgets (RevenueChart/PaymentMixChart/overview stats) now `canManageMoney`-gated; review flag/unflag now `canModerate`-gated (7 tests). **POLICY-DECIDED (owner): GMV stays visible to ops, and the full-user CSV export stays open to all admins — both accepted, not gated.** Systemic pattern remains: new resources still need self-gating. |
| H-F | **Booking create fans out blocking work synchronously** (Xendit ≤12s + inline matching) → FPM pool exhaustion under create concurrency | Create → return checkout intent → confirm via webhook/poll; keep matching sync if needed. |
| H-G | **Reverb single-process, scaling disabled, no Octane** — websocket ceiling + horizontal blocker | `REVERB_SCALING_ENABLED=true` (Redis) before horizontal scale; dedicated core. **(ops/config)** |
| H-H | **Inline DomPDF pins FPM workers** (≤500-item statements; receipt route was unthrottled) | Queue → signed download URL; **receipt route now throttled 6/min [FIXED 2026-08-17]**. |
| H-mobile | **God-screens + ~231 `any` + ~0 screen/hook tests** — highest-risk mobile code is hardest to change and unprotected | Extract hooks/sub-components (<500 lines/route); type the `api` seam (`ExtraConfig`) to erase ~48 casts; add hook tests for `useQuery`/`usePaymentVerification`/`useChat`. |
| H-a11y | **Dynamic Type disabled app-wide** (`_layout.tsx:66-74`) | Re-enable `allowFontScaling` with `maxFontSizeMultiplier ≈ 1.3–1.4`; verify money/countdown/tab layouts at the cap. **(mobile — needs device verification)** |
| H-safety | **SOS→contacts marketed but the notify job is inert** | Wire SMS/push to trusted contacts on SOS, or pull the promise from onboarding until it works. |
| H-privacy | **Raw counterparty phone exposed** (`tel:` both sides; `UserResource.phone` not self-gated) | Ship masked/proxied calling; gate `phone` to active bookings. |

### 🟡 Medium
`payments.status` unindexed **[FIXED 2026-08-17]** · dispute `resolve()` API is money-blind (Filament path is correct) · `.env.production.example` stale **[FIXED 2026-08-17]** · `WalletTransaction::$display_description` `$appends` lazy-load (latent N+1) · inline FCM sends without timeout · fragile `tries=1` jobs with no `failed()` · unbounded scheduled queries (`CheckRideDurationJob->get()`, message purge) · CI deploy fire-and-forget · mobile map/payment keys absent from `eas.json` prod · no log aggregation · OTA no staged rollout · `/health` unmonitored · hard login wall / no guest funnel · OTP resend 5-min · account enumeration on forgot-password · profile role/email/phone change without re-verification.

### 🟢 Low
`generateBookingNumber()` check-then-insert race (no unique-violation catch) · file responses skip `nosniff`/`no-store` headers · fat booking-list payload (eager `reviews`) · a few unbounded per-user `->get()` lists · redundant `created_at` index · support IA inconsistency + dead deep-link params · Contacts permission primer before signup · password reset email-only/web-completed · hardcoded cancel reason.

---

## 12. Root-cause themes

1. **Operations lag code.** Nearly every ops primitive exists but is inert (Sentry no DSN, backup disk local, no alert routing, cron/worker unverified). *Built ≠ operational.*
2. **Single-box, correlated failure.** One Redis and one Forge server concentrate risk; graceful degradation isn't wired.
3. **A fat orchestrator drifts.** The 1,200-line `BookingController`/`store()` is the root of both the `rebook` money bug and the "dispatch before capture" gap — logic that should live in one shared service is copied and diverges.
4. **Mobile: strong runtime, thin safety net.** Excellent data/UX foundations, but god-screens + ~0 tests make change risky, and there's no crash telemetry to catch what slips.

---

## 13. Prioritized roadmap

### Quick wins (hours; safe) — several shipped this pass
- **[DONE]** Close the `rebook` money loss; strip PII from auth logs; add `payments.status` index; guard the create-path broadcast; throttle the receipt PDF; sync the prod env template.
- Set the real `eas.json` prod Reverb key + build-time `REPLACE_WITH` assert. *(mobile)*
- Set `SENTRY_LARAVEL_DSN` + `DB_BACKUP_DISK=s3`/`AWS_*` + `TRUSTED_PROXIES` in Forge; create Sentry alert rules → Slack; point an uptime monitor at `/health`. *(ops)*
- `php artisan down/up` around migrate in `deploy.sh`; export `SENTRY_RELEASE`.

### High-impact (days)
- Add `@sentry/react-native` (mirror the inert backend wiring) + Hermes source maps. *(mobile)*
- Real `failover` cache store (redis→database) or fail-open the limiter/presence — kill the Redis-SPOF total outage.
- Never-paid guard on online bookings (H-B); defer matching until capture or block runner progression.
- Scheduler heartbeat + `failed_jobs`/queue-depth probe + `Queue::failing` → alert; add `failed()` to the bare jobs.
- Re-enable capped Dynamic Type; make SOS→contacts real (or drop the claim); ship masked calling; add a guest browse/estimate funnel; cut OTP resend to ~45s. *(mobile/product)*
- Default-deny Filament base resource + cap-gate the leaked surfaces (H-E).

### Long-term (weeks)
- Atomic/zero-downtime deploys + rollback (Envoyer/Deployer); managed Redis HA + MySQL PITR; break the single-server SPOF.
- Enable Reverb scaling + a dedicated instance; move gateway invoice creation + DomPDF off the request thread.
- Decompose the god-screens (backend `store()` + mobile tracking/booking) into shared services/hooks; build out screen/hook test coverage; type the mobile API seam.

---

## 14. Implemented this pass (2026-08-17)

All backend, triple-checked (php -l + full suite **595 green on SQLite + MySQL 8**) and adversarially reviewed. Commits `f34852f`, `9c6d4c9`, `1dc23c2`, `f7ad515`, `fff27fb`.

*Batch 1 — money + hardening*
1. **🔴 `rebook()` money-loss — CLOSED.** No longer creates an unpaid booking or dispatches a runner; returns a prefill for the normal paid `store()` flow. Regression test asserts *no* booking created and *no* `MatchRunnerJob` dispatched.
2. **🟠 PII out of logs.** Removed raw phone/email/identifier from Login/OTP/PasswordReset log contexts (CWE-532).
3. **🟠 Create-path broadcast guarded.** The synchronous match notifications (`SendPushJob` + `IncomingRequest`) are wrapped so a Reverb/queue hiccup can't 500 a committed booking (the referral-driving `BookingStatusChanged` is intentionally left unguarded).
4. **🟠 Receipt-PDF route throttled** (6/min); **🟡 `payments.status` index** added (verified the auditor's other three indexes were already covered or unused).
5. **🟡 Prod env template synced** — added the missing security/DR/observability vars (`TRUSTED_PROXIES`, `DB_BACKUP_DISK`+`AWS_*`, `SENTRY_*`, Sanctum/CORS/body-cap).

*Batch 2 — admin authz + Redis degradation (H-E / C-redis)*
6. **Revenue widgets gated** — RevenueChart / PaymentMixChart / the dashboard GMV+revenue stats now `canManageMoney`-only.
7. **Review moderation gated** — flag/unflag (bulk + record) now `canModerate`-only.
8. **`EnsureUserActive` fails open** on a cache error, and the `failover` cache store recomposed redis→database→array.

*Batch 3 — failure visibility (C2 / C3)*
9. **Failed jobs alert** — `Queue::failing` → CRITICAL log + a `job_failed` admin alert.
10. **Scheduler liveness** — an every-minute heartbeat surfaces `scheduler: ok|stale|unknown` in `GET /health` (informational; never 503s the box).

The remaining criticals are, by design, the ones that need **you**: the mobile `eas.json` key + crash SDK (device build), and the ops activations (Sentry DSN + alert rules, uptime monitor → paging, off-site backups/PITR, atomic deploy, `CACHE_STORE=failover`) — none of which can be done or verified from the repo alone.
