# ErrandGuy — Payment System Review & Modernization Roadmap (2026-07-28)

**Scope:** the entire payment ecosystem across customer, runner, admin, and finance —
booking payments, wallet, top-ups, runner payouts, refunds, cancellations, service fees,
platform commission, promos/referrals, coupons/gift cards, failures/retries, receipts,
reporting, and admin money tooling — across the Laravel API (`errandguy-api`), the Expo
app (`errandguy-mobile`), and the NestJS backend (`errandguy-nest`).

**Method:** produced by a 59-agent review workflow — 6 domain reviewers mapped the code,
every material money-finding was **adversarially verified against the source** (44 confirmed,
4 partial with corrections, **1 refuted and dropped**), then a completeness critic swept for
missing workflows/compliance. This supersedes nothing in `SYSTEM_AUDIT_2026-07.md`; it
extends it with payment-specific depth and marks which prior findings remain open.

**Counts:** 73 findings → **1 critical, 18 high, 28 medium** confirmed (+ lower). Roadmap:
14 P0 · 12 P1 · 15 P2 · 12 cross-cutting/compliance.

---

## Verdict

The payment **core is genuinely strong** and should be preserved, not rewritten:

- Every `payments.status` change funnels through the audited `Payment::transitionTo()` state
  machine (verified — **no raw `->update(['status'…])` on payments anywhere**), with a
  terminal-aware `PaymentStatus::allowed()` map.
- The Xendit webhook is timing-safe (`hash_equals`), replay-guarded (DB-unique `webhook_events`),
  row-locked, and out-of-order safe (`canAdvance()`).
- `WalletService` deduct/refund/top-up/payout are lock-first and idempotent, backed by DB unique
  constraints shared by both backends.
- The mobile "verify, never assume" layer (`paymentStore` + `usePaymentVerification` +
  `PaymentProgress`) resumes across relaunch, and a webhook-independent pull reconciler exists.
- The prior audit's biggest leak — **C2 "cash-completion pays uncollected money" — is CLOSED**
  (cash now debits the platform fee as a negative commission).

The risk is concentrated in three seams, plus a thin admin/finance surface and missing
marketplace + compliance table-stakes.

### The three seams
1. **Refund semantics are broken/ambiguous.** Online (card/GCash/Maya) cancellations credit the
   in-app **wallet** yet stamp `Payment.status = Refunded` — so a "refunded" record can mean a real
   Xendit reversal *or* trapped store credit (the only distinguishing marker, `refunded_to=wallet`,
   lives in the transition log, not on the Payment). Partial gateway refunds flip the payment to a
   **terminal** state (no remaining refund ever possible). The admin Refund action blindly POSTs to
   Xendit even for **wallet/cash** payments (null `payment_request_id` → throws → no money returns)
   and accepts an **unbounded amount**.
2. **Money can leak or double-move.** Promo `used_count` increments *before* payment and is never
   rolled back on the FK-violating hard-delete cleanup; **referral bonuses are withdrawable** with no
   payment-funded/device guard; the runner **payout debit has no DB idempotency + no throttle** +
   soft idempotency header (double-tap → double debit); under-settled webhook charges are marked paid
   (the amount tripwire only logs); cash cancellation fees and cash-commission debt are recorded but
   **never collected**; and a completed-booking refund **never claws back the runner's earning**.
3. **Dual sources of truth.** `Booking.payment_status` is an unguarded free-string that drifts from
   the guarded `Payment.status` (a real gateway refund never updates the booking), and a second
   **NestJS backend re-derives every money rule against the same production DB**.

---

## Fix these first (top 6)

1. **Reconcile refund semantics** — real gateway reversal vs. wallet credit; stop falsely stamping
   `Refunded`. *(P0-1)*
2. **Harden the admin Refund action** — method routing (wallet/cash never hit Xendit) + amount bounds
   + partial-refund correctness. *(P0-3, P0-4)*
3. **Runner payout double-debit** — stable `reference_id` + DB unique + throttle + hard idempotency.
   *(P0-8)*
4. **Referral cash-out farming** *(the one CRITICAL)* — bonuses non-withdrawable + payment-funded gate.
   *(P0-6)*
5. **Booking-create gateway-failure** — FK-violation 500 + orphan rows; wrap in a transaction. *(P0-2)*
6. **Guard `Booking.payment_status`** against `Payment.status` drift (single derived source). *(P0-5)*

---

## P0 — Money integrity (do first)

Each preserves the `transitionTo` / webhook / lock invariants. **Add real-Postgres money tests** —
SQLite (FK-off) masks the FK and lock behaviors today.

1. **Refund semantics: real reversal vs. wallet credit** — *[L] customer/admin/finance.* Branch
   `BookingController::cancel`, `BookingService::refundUnfulfilled`/`adminCancel` on `payment.method`:
   gcash/maya/card → `PaymentService::refundPayment` (settle via `refund.succeeded`); wallet-funded →
   `WalletService::refund`. If refund-to-wallet is deliberate for online funding, add a distinct
   `PaymentStatus::RefundedToWallet` (or a `refunded_to` column) so status stops asserting a reversal
   that didn't happen. **Caveat:** confirm Xendit supports programmatic refunds for GCash/Maya *to
   source* (often not) — if not, wallet credit is forced and this must be modeled honestly.
2. **Booking-create gateway-failure cleanup** — *[M] customer.* `store()` does `transitionTo(Failed)`
   then `$booking->delete()` while a Payment FK references it (Postgres NO ACTION → 23503 → uncaught
   500 instead of the intended 422; orphan rows persist; no wrapping transaction). Wrap create + promo
   redeem + Payment::create + charge in one `DB::transaction`; prefer leaving the booking
   `payment_status='failed'` + 422 over hard delete.
3. **Partial-refund correctness** — *[M] admin/finance.* `refundPayment` always goes terminal
   `Refunded` and overwrites `refund_amount` with the latest partial → no further refund possible,
   and the Xendit idempotency key `rf-{id}` is per-payment so a 2nd partial collapses to the first.
   Track cumulative refunded; only go `Refunded` when cumulative == charged; per-refund idempotency key.
4. **Harden admin Refund action** — *[M] admin/finance.* Guard `method ∉ {wallet,cash}` + non-blank
   `gateway_tx_id` (route wallet/cash to `WalletService::refund`); validate
   `0 < amount ≤ (charged − already_refunded)` server-side + mirror in the Filament form.
5. **Guard `Booking.payment_status` drift** — *[M] all.* Derive it from `Payment.status` via one
   guarded setter (enforce the existing-but-bypassed `BookingPaymentStatus` enum) used by webhook /
   reconcile / cancel / refundUnfulfilled / **refundPayment** (which currently never updates it).
6. **Referral bonuses withdrawable + no abuse guard** *(CRITICAL)* — *[L] all.* Bonuses credit the
   commingled `wallet_balance` for both parties and fire on *any* completed booking (even cash/uncollected);
   a runner account can farm alt-referrals into its withdrawable wallet. Make `type=bonus` a
   non-withdrawable sub-balance (exclude from payout), gate `reward()` on a *paid non-cash* completed
   booking, add device/phone/instrument signals + a per-account cap.
7. **Promo `used_count` leak + validate/redeem TOCTOU** — *[M] customer/admin.* Redeem increments
   before payment and is never rolled back on hard-delete; separate unlocked validate→redeem lets
   concurrent bookings exceed limits. Move redeem after settlement (or one transaction + rollback);
   `lockForUpdate` the PromoCode row and re-assert limits (or conditional `UPDATE … WHERE used_count < limit`).
8. **Runner payout double-debit** — *[M] runner/admin/finance.* Payout rows have `reference_id=NULL`
   (excluded from the unique index), the idempotency header soft-passes when absent, and the route has
   no throttle. Give payouts a stable `reference_id` + extend the unique guard, add a throttle, and
   enforce a hard 428 for `/payout/request` + `/top-up`.
9. **Under-settled webhook charge marked paid (audit H10)** — *[S] customer/finance.*
   `verifySettledAmount` only `Log::critical()`s; the webhook then completes anyway (the pull
   reconciler correctly refuses). Leave short settlements pending/needs-review; same for `completeTopUp`.
10. **Cash cancellation fee & cash-commission debt never collected** — *[L] customer/runner/finance.*
    `cancellation_fee` only moves inside the `paid` branch (cosmetic for cash); runner commission debt
    can go negative with nothing collecting it. Record cash cancellation fee as an owed debt; add a
    negative-balance cap + "settle before online/payout" gate + dunning job. (Residual half of C2.)
11. **Completed-booking refund doesn't claw back the runner's earning** — *[M] runner/admin/finance.*
    Admin refund on a completed paid booking refunds the customer while the runner keeps the payout
    (net platform loss). Create an idempotent compensating `commission`/clawback entry keyed on the booking.
12. **Promo discount can drive platform net negative** — *[S] customer/admin/finance.* Discount reduces
    only customer total; `service_fee`/`runner_payout` unchanged, so the fee funds the whole discount.
    Enforce `platform_net = service_fee − discount ≥ 0` (cap discount at the fee) in `PricingService`.
13. **Payout destination integrity** — *[M] runner/admin/finance.* `payout_channel_code` is *read* by
    the disbursement UI but **never written** (admins hand-guess the PH_* channel vs free-text bank
    name — misroute risk), and no destination is snapshotted at request time (edit-between-request-and-send
    reroutes funds). Add a persisted channel picker + snapshot destination onto the payout row.
14. **Single source of truth for money logic (Laravel vs NestJS)** — *[XL] admin/finance.* `errandguy-nest`
    re-implements payment/wallet/payout/status against the same prod DB; transition-map/refund/amount/float
    logic can diverge. Own money logic in one backend (or share the rules) before scaling; gate both on the
    same real-Postgres suite.

---

## P1 — UX & transparency (make the numbers honest & legible)

1. **Itemize the vehicle premium** — *[M] customer.* `VEHICLE_BASE_PREMIUM` is baked into the total but
   never persisted/shown, so the mobile breakdown under-sums the charge by ₱25 (default motorcycle).
2. **Align negotiate "settles later" copy with the up-front charge** — *[S] customer.*
3. **Fix mobile promo preview showing ₱0 saved** — *[S] customer.* Reads a non-existent field + sends no
   `?amount=`, so the "you save" chip is always ₱0.
4. **Show platform fee + net take-home to the runner per errand** — *[M] runner.*
5. **Clarify gross earnings vs. withdrawable balance** — *[S] runner.* Two trust-critical numbers disagree
   across screens with no explanation (cash fares are off-wallet).
6. **Push on payout completion/failure** — *[S] runner.* (`completeTopUp` already pushes; payout doesn't.)
7. **Show masked "account on file" instead of a blank payout field** — *[S] runner.*
8. **Fix saved payment methods that can't be charged; clarify card support** — *[M] customer.* `store()`
   can mint display-only methods indistinguishable from chargeable; card can't be linked at all.
9. **Issue receipts only for settled payments** — *[S] customer/finance.*
10. **Treat "refunded" as a distinct outcome, not a payment failure** — *[S] customer.*
11. **Failure/retry policy for failed/expired online charges** — *[M] customer/runner.* No re-invoice/dunning,
    and the booking status isn't transitioned (runner stays reserved).
12. **Drive cash Payment rows to a terminal state** — *[S] runner/finance.* Cash payments sit `pending`
    forever, so the ledger never reflects collection.

---

## P2 — Strategic marketplace finance

1. **Refunds ledger** with first-class partial-refund accounting (`refunds` table; derive status/remaining). *[L]*
2. **Maker-checker refund approval** workflow + caps (no separation of duties on money-out today). *[L]*
3. **Coupons, gift cards, loyalty/points** — none exist; build as guarded, idempotent ledgers; decide
   cashable vs non-withdrawable + stacking rules. *[XL]*
4. **Fraud/velocity/suspicious-transaction controls** — none exist beyond login rate-limiting. *[L]*
5. **Xendit dispute/chargeback webhooks** — currently hit the `default null` arm (no state change/alert). *[M]*
6. **Admin GMV/commission/reconciliation reporting + export** — `ExportController` is user-scoped only. *[L]*
7. **Finance dashboard tiles** (commission/net revenue, refund volume, wallet liability, pending-payout value). *[M]*
8. **Wallet adjustment/correction admin capability** (`WalletService::adjust` + guarded Filament action). *[M]*
9. **Surface `webhook_events` + the activity log in Filament** (audit trail for disputes). *[M]*
10. **Link disputes to payments** + resolve-with-refund + a runner issue flow (wire the dead `/support/report`). *[L]*
11. **Type/validate `SystemConfig`** (a bad `platform_fee_percent` silently zeroes commission); consider
    per-errand-type commission. *[M]*
12. **Consolidate payout paths** (single min source, atomic debit+disburse, bulk + scheduled auto-payout). *[L]*
13. **Delete divergent dead money code** (`processBookingPayment`/`createPaymentRequest`, `PricingService::applyPromo`). *[M]*
14. **Move reconcile pulls off the request path** (queue/async; Redis `Cache::add` atomic latch). *[M]*
15. **Define promo/negotiate/cancellation economics explicitly** (discount base, negotiate take-rate floor,
    cancellation-fee runner split). *[M]*

---

## Cross-cutting — compliance & financial architecture (critic pass; several are gating)

These sit *under* the P2 reporting items — reporting/reconciliation can't be correct without them.

- **Tax layer (PH 12% VAT, BIR Official Receipts, runner withholding)** — *[XL] regulatory.* No VAT computed
  or shown, no sequential OR numbering, no withholding on disbursements. Statutory exposure. Scope with a PH
  tax advisor.
- **Capture Xendit gateway/disbursement fees into the ledger** — *[M].* MDR/settlement fees are never recorded,
  so every net-revenue report overstates margin and reconciliation can never tie to Xendit's *net* settlement.
- **Double-entry ledger** — *[XL].* `WalletTransaction` is single-sided against one commingled balance; there's
  no balanced ledger, so leaks can't be detected as a non-zero trial balance. This is the substrate P2 reporting assumes.
- **Integer-cents / BCMath money math** — *[M].* `WalletService` does balance arithmetic on PHP `float` despite
  `decimal:2` columns → sub-centavo drift accumulates. A live correctness bug in the authoritative path.
- **E-money float safeguarding + credit expiry** — *[L] regulatory.* Wallet balances are real customer funds
  (commingled, never-expiring liability) with no BSP e-money posture or escheatment policy.
- **Automated daily settlement reconciliation with break alerting** — *[M].* Today's reconcile is an on-request
  pull, not a scheduled control that ingests Xendit's settlement report and raises breaks.
- **Stuck-pending online-charge reaper** — *[M].* An abandoned online charge (no webhook, no reconcile) leaves the
  Payment pending and the runner reserved indefinitely.
- **Pro-rata / partial-fulfillment refunds** — *[M].* All-or-nothing at booking level; no model for partial
  shopping delivery or mid-errand abort (distinct from partial *gateway* amount).
- **Release consumed promo on refund/cancel** — *[S].* Mirror of the P0 leak — a refunded promo booking loses the promo.
- **Payout recall / misdirected-disbursement recovery** — *[M].* Snapshot is added but there's no reverse/clawback flow.
- **Declare PCI scope + tokenization ownership before card-on-file** — *[M] compliance gate.* `store()` persists a
  raw `gateway_token`; confirm no PAN transits ErrandGuy (Xendit hosted fields only) before shipping card linking.
- **Refund SLA + source-vs-wallet customer messaging** — *[S].* No time-to-refund SLA; no "credited now" vs
  "reversal in N days" distinction; no dunning for stuck refunds.
- **Multi-currency** — *[note].* Whole stack hardcodes PHP; state the single-currency boundary as an explicit constraint.

---

## Recommended execution sequence

- **Phase A — Stop the bleeding (P0-1..9, ~2–3 focused batches).** Refund semantics + admin refund
  hardening + partial-refund correctness + payout idempotency + referral segregation + booking-create
  transaction + payment_status guard + settled-amount enforcement. Ship behind real-Postgres tests.
- **Phase B — Close the leaks (P0-10..14 + promo economics).** Cash debt collection, earning clawback,
  destination integrity, dead-code + single-source-of-truth decision.
- **Phase C — Honest UX (all P1).** The customer/runner numbers become legible and consistent.
- **Phase D — Finance surface (P2 reporting/adjustment/audit/disputes/fraud) on a double-entry + gateway-fee
  substrate.** Sequence the ledger + fee-capture + reconciliation *before* the reporting tiles.
- **Phase E — Marketplace + compliance (coupons/gift cards/loyalty, tax/VAT/OR, e-money posture, PCI).** Scope
  each with product/finance/legal before building.

## Verification note
1 finding was **refuted and dropped**: a claim that `SYSTEM_AUDIT_2026-07.md` is missing — it exists at the
**repo root** (one level above `errandguy-api`), so prior findings were available and cross-checked. All other
material findings above were confirmed against the source (4 carried minor corrections, already folded in).
