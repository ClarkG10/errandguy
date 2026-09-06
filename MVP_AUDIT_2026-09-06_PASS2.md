# ErrandGuy — Startup MVP Audit, Pass 2 (2026-09-06)

*A second independent pass over the same question as `MVP_AUDIT_2026-09-06.md`, run without sight of it. It reached the same structural conclusion by a different route — **the problem is duplication, not over-featuring** — and found two things the first pass did not, one of which is the most serious defect in the product.*

*Implemented, tested and committed in `c54c6c1`: **972 API tests, 818 Jest tests, `tsc` clean.***

> **Read the first pass too.** It owns the money-settlement analysis (the reconciler P0, booking/tip reconciliation) and a deeper database and dead-code inventory. This document does not repeat it. Where the two overlap, they agree.

---

## 1. What the system actually is

A two-sided on-demand errand marketplace for the Philippines, pre-launch.

| | |
|---|---|
| **Customer** | picks an errand type → enters pickup/dropoff → gets a price → pays (wallet / GCash / Maya / card / cash) → matched to a runner → live tracking + chat → completion → receipt, rating, optional tip |
| **Runner** | KYC → go online → receive offer → accept → navigate → proof (photo / PIN / signature) → complete → earnings → payout |
| **Operator** | Filament v4 panel: moderate users and bookings, verify KYC, process payouts, work support tickets and disputes |

**Scale:** ~35k LOC API (52 controllers, 15 services, 29 models, 76 migrations), ~79k LOC mobile (~60 routed screens, 135 components).

**Revenue path:** `book → pay → match → track → complete`. **Supply path:** `online → offer → accept → complete → paid`. Everything else — heatmap, referrals, promos, trip-share, multi-stop, scheduling — is an accelerant, not the business.

---

## 2. The headline finding: a safety feature that lied 🔴

**SOS told people in an emergency that their trusted contacts had been alerted. Nobody had been.**

The chain, end to end:

1. `SOSService::triggerSOS` wrote `contacts_notified = [every trusted contact id]` **inside the creating transaction** — before any delivery was attempted.
2. `NotifySosContactsJob::notifySMSContact` sends nothing. There is no SMS provider wired anywhere in the system; it logs a breadcrumb and returns.
3. The mobile client reads that exact field and renders it as *who the alert reached*: **"Alerted ErrandGuy support and 3 trusted contacts."**
4. The confirm dialog beforehand promised the same: *"This alerts ErrandGuy support **and your trusted contacts** with your live location."*

The client was not careless — its code comment reads *"Only names contacts when the server confirmed them"*, and the runner-side surface had already been corrected on exactly this reasoning. The guard was right; the server's misnamed write defeated it. `contacts_notified` was an **intent** list wearing the name of a **delivery** record.

This is the worst class of bug this product can have: not a crash, but a false assurance given to someone who may be in danger, at the moment they are deciding whether they still need to act themselves.

**Fixed.** `contacts_notified` now means delivery-confirmed and has exactly one writer — the fan-out job, on success only. With no provider it stays empty, so the app truthfully says support alone was alerted. Wiring a provider later is a one-line `return true`; every surface downstream keys off it.

**And made useful, not just honest.** The live SOS card now lists the person's trusted contacts with one-tap dial and says plainly *"We don't contact these people for you — tap to call."* A voice call is also the one channel that still works with no data. The admin SOS view separates *who we auto-notified* from *who you still have to ring*, so an operator does not read an empty list as "this person has no contacts".

**Still open (product decision):** wire Semaphore/Twilio, or accept that trusted contacts are a call list and say so everywhere. The code is now honest under either choice.

---

## 3. Second finding: unbounded runner cash debt 🔴

On a cash errand the runner collects the entire fare in person and keeps their payout, so the platform takes its commission by **debiting their wallet**:

```php
$commission  = total_amount − runner_payout;
$newBalance  = wallet_balance − $commission;   // no floor, no ceiling, no guard
```

There was **no negative-balance check anywhere in the system** — not at accept, not at dispatch, not at go-online. A runner could take cash errand after cash errand, drive their balance arbitrarily negative, and simply stop opening the app. That is real money the platform never receives, and in this market cash is expected to be the dominant method. It scales with how well the product works.

**Fixed** with a `runner_cash_debt_limit` lever (default ₱1,000; `0` disables). One shared `CashDebtPolicy` gates all three surfaces — dispatch, the pull feed, and `accept()` under the runner's row lock — so they can never drift into offering work that is certain to be refused.

Two deliberate properties:

- **Cash only.** Prepaid and wallet errands *credit* the runner, so the route back above the line is always open. A block with no exit would be worse than no block.
- **It explains itself.** The refusal names the exact amount to settle, and the runner dashboard shows why the feed is short. A silently shorter offer feed is its own bug — the runner would conclude the app was broken.

---

## 4. Third finding: the admin surface existed twice ✅ removed

A complete `/api/v1/admin/*` REST API — **26 endpoints, 8 controllers, 2 middleware, ~709 lines plus ~650 lines of tests** — with **no client in either repo**. The Filament panel already does every one of those jobs.

This was not merely dead weight. It was a second, independently maintained implementation of payouts, refunds, user suspension and dispute resolution, plus a public `/admin/login` minting 8-hour privileged bearer tokens for nobody to use.

**Removed**, with two care-points that mattered:

- Both surfaces already routed through the same `WalletService` / `BookingService`, so no money path changed. Tests that covered *shared* logic were **re-pointed at those services** rather than deleted — the payout complete/fail/re-credit coverage survives intact.
- Filament's dispute `resolve` and `escalate` were the **weaker** of the two implementations: they guarded transitions only with `visible()`, which is a render-time check, so two admins acting at once could overwrite the original resolver in the audit trail, double-push the reporter, or drag a resolved dispute back to `escalated`. Both now carry the row-locked preconditions only the deleted twin held. **Collapsing to one implementation lost no safety.**

---

## 5. Dead code: there is far less than expected

A mechanical sweep of both repos — every component, hook, util, service, store, model, controller, command, middleware, policy, table and column, cross-referenced against both codebases:

| Sweep | Result |
|---|---|
| Mobile source files (390) | **1 orphan** (`utils/systemFont.ts`) |
| Mobile exported symbols | **0 unused** |
| API classes | all live except 3 — the rest are framework auto-discovery (commands, Filament, aliased middleware) |
| DB columns | **0 unused** application columns; the only flags are framework tables and a `two_factor_secret` stub |
| API routes | every route has a caller **except** the admin block (§4) |

Deleted: `systemFont.ts`, `BookingPaymentStatus` (zero references), `RunnerErrandPolicy` (never registered — no `RunnerErrand` model for auto-discovery, and its accept/status rules live inline in the controller anyway).

**This is the finding, and it is a good one:** for a codebase this size, this is unusually clean. The team's problem is not accumulated junk. See the first pass for a longer dead-code list (the zod stack, orphaned SVG, unused native map SDKs) — those hold up.

---

## 6. Where the system can still fail

Verified by reading the actual failure paths, not the docs:

| Scenario | Behaviour | Verdict |
|---|---|---|
| **Queue worker dies** | Money is safe. `reap-stranded-bookings` and `detect-stalled-errands` run in the **scheduler**, not on the queue, precisely because the worker is the thing that fails. Immediate matching is `dispatchSync`, so booking works with no worker at all. | ✅ genuinely well designed |
| **…except SOS** | The SOS fan-out is the one safety path still riding the queue. The durable record and the admin alert are written synchronously, so nothing is lost — but the counterpart's push and the admin topic alert wait on a healthy worker. | 🟠 P1 (agrees with pass 1) |
| **Double-tap / replayed request** | Idempotency middleware + `uq_wallet_tx_user_reference_type` + row locks throughout. | ✅ |
| **Two runners accept at once** | `lockForUpdate` on the booking, then the user row, in a consistent order. | ✅ |
| **Payment fails at create** | Booking marked failed (never hard-deleted), promo reversed, honest error copy. | ✅ |
| **Customer kills app mid-checkout** | Reconciler + auto-cancel + stranded reaper. | ✅ (closed by pass 1) |
| **Runner accepts, then something goes wrong** | **No exit.** No cancel endpoint; they cannot even go offline. Every incident needs a human. | 🟠 P1 — needs a policy decision |

---

## 7. What should be cut, deferred or left alone

**The system is not over-featured — it is over-duplicated.** The machinery that looks like a luxury (idempotency, the payment state machine, the offline mutation queue, SOS, KYC) is correctly sized: it is what makes strangers transacting cash with strangers safe. Cutting it would be the wrong subtraction.

| | |
|---|---|
| **KEEP** | SOS + trusted contacts, offline mutation queue, idempotency, payment state machine, KYC, the scheduler-based money backstops |
| **SIMPLIFY** | The three god screens (3.3–3.5k lines each) — the only structural render cost worth acting on |
| **DEFER** | Transportation/ride-hailing — a separately regulated business threaded through the errand code, and **one admin toggle** to keep out of the launch catalog. Narrowing the 10-type catalog also sharpens the story |
| **DEFER** | Negotiate pricing mode — a second full pricing path (broadcast, expiry, offer feed, countdown) doubling the surface of the thing that takes money |
| **REMOVE** | ✅ the admin REST API (done) |
| **RESOLVE** | **Disputes.** Confirmed independently: `DisputeTicket` has exactly one writer — the `/support/report` closure — whose only client method (`configService.submitReport`) is **called by no screen**. No dispute can be filed. The only "Resolve + refund" tool sits behind that dead queue, so **the primary customer-refund workflow is unreachable in production.** Wire the intake or move the refund action; it cannot stay as-is |

---

## 8. Production readiness

**The code is production-grade. The gate is operational, and has been for three audits running.**

| Dimension | State |
|---|---|
| Reliability | ✅ core flows complete; worker-outage backstops real |
| Data integrity | ✅ decimals everywhere, row locks, idempotency, append-only ledger |
| Security | ✅ hardened over 8 sweeps; ✅ one fewer admin credential surface as of this pass |
| Error recovery | ✅ reconcilers, reapers, honest client copy |
| Maintainability | 🟠 three 3k-line screens; ledger writes copy-pasted ~15× (pass 1) |
| **Observability** | 🔴 **Sentry is inert until a DSN is pasted** |
| **Backups** | 🔴 **no verified off-box backup / PITR** |
| **Ops verification** | 🔴 worker + cron + Reverb unverified in prod |
| **Device QA** | 🔴 nothing in this pass was run on a physical device |

---

## 9. Prioritized roadmap

### 🔴 P0 — done this pass
1. ✅ **SOS no longer claims contacts were alerted** and gives the user a working alternative.
2. ✅ **Runner cash debt is capped** and the block explains itself.

*(Pass 1's P0 — the reconciler leaving an unpaid booking live — is also fixed, in `284e707`.)*

### 🟠 P1 — before launch
1. ✅ **Delete the clientless admin REST API** *(done this pass — was pass 1's P1 #3)*.
2. **Wire an SMS provider, or finish the decision** that trusted contacts are a call list. Code is honest either way.
3. **Give a runner an exit** from an accepted errand. Needs a cancellation/penalty policy.
4. **Move SOS fan-out to the scheduler**, like every other safety backstop.
5. **Extract one wallet credit/debit primitive** and route all ~15 sites through it *(pass 1 — highest-leverage maintainability fix)*.
6. **Resolve Disputes** — the refund workflow is currently unreachable (§7).
7. **De-duplicate the chat screen** (88% identical, already diverging).

### 🟡 P2
Wallet debit + booking paid-flag in one transaction; backstop for bookings stranded at `delivered`; prod assertion that the money `UNIQUE` guards exist; drop redundant indexes and the unused native map SDKs; consolidate the notification inbox; retire the always-failing phone-OTP branch (`sendViaSMS` throws — the app already verifies by email).

### 🔵 P3
Remaining dead-code deletions; god-screen decomposition; `runner_locations` retention; `phone_verified` is fetched for every counterparty and is permanently `false` for everyone.

---

## 10. Owner decisions — nothing else unblocks these

1. **Sentry DSN**, **off-box backups/PITR**, **verify worker + cron + Reverb in prod.** Three audits have ended here.
2. **SMS provider** — yes/no. It gates real SOS delivery and phone verification.
3. **Cash-debt limit** — ₱1,000 is a placeholder. It is one config row.
4. **Runner cancellation policy** — needed before P1 #3 can be built.
5. **Launch catalog** — 10 errand types, or fewer.
6. **On-device QA.** The SOS call list and the cash-debt banner are UI changes verified only by test and typecheck. Someone must open the app.

---

## Bottom line

Two passes agree: **the work now is subtraction and honesty, not addition.** The money is well protected, the schema is sound, the safety machinery is correctly sized — and the two defects that mattered most were both cases of the system *reporting something that was not true*: a charge silently abandoned while the errand stayed live, and an emergency alert that reached nobody while telling the user it had reached three people.

The remaining launch gate is not code. It is a Sentry DSN, a backup you have restored from once, and someone opening the app on a real phone.
