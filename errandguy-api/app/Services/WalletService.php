<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class WalletService
{
    /**
     * Minimum seconds between gateway pulls for the SAME charge (a GCash/Maya
     * tip, or a legacy top-up).
     *
     * The app polls the status endpoint every ~3s and each pull is a blocking
     * Xendit GET occupying an FPM worker, while the webhook remains the primary
     * real-time settlement path — so pulling at most once per window loses no
     * freshness. The scheduled sweep passes its own (much longer) window.
     */
    public const RECONCILE_PULL_THROTTLE_SECONDS = 10;

    public function getBalance(string $userId): float
    {
        return (float) User::where('id', $userId)->value('wallet_balance');
    }

    /**
     * The ONE way a wallet balance moves.
     *
     * The read→compute→create-row→update-balance ritual was copy-pasted across
     * ~15 sites in three files, and had already DRIFTED: the runner earning
     * credited at completion did not round the payout while the one back-filled
     * after a late settlement did, so the same booking could credit different
     * amounts depending on which path settled it — and both wrote an unrounded
     * `balance_after` into the ledger the wallet reconciler treats as truth.
     *
     * This writes the ledger row and the balance TOGETHER, from one rounded
     * figure, so they can never disagree and every row's `balance_after` is
     * exact. Rounding happens once, here.
     *
     * Deliberately does NOT lock or open a transaction, and does NOT own
     * idempotency: callers legitimately differ (some already hold a booking
     * lock, some guard on a unique reference, some on a status precondition),
     * and hiding those decisions here would make each site harder to reason
     * about, not easier.
     *
     * CONTRACT — the caller MUST:
     *   1. be inside a DB transaction, and
     *   2. already hold a `lockForUpdate` on $user (the balance is read off the
     *      passed model, so an unlocked read is a lost update).
     *
     * @param  User  $user  a row the caller has locked
     * @param  float  $delta  signed: positive credits, negative debits
     * @param  array<string,mixed>  $extra  extra ledger columns (status, gateway_ref, …)
     */
    public function applyLedgerDelta(
        User $user,
        string $type,
        float $delta,
        ?string $referenceId,
        string $description,
        array $extra = [],
    ): WalletTransaction {
        $delta = round($delta, 2);
        $newBalance = round((float) $user->wallet_balance + $delta, 2);

        $transaction = WalletTransaction::create(array_merge([
            'user_id' => $user->id,
            'type' => $type,
            'amount' => $delta,
            'balance_after' => $newBalance,
            'reference_id' => $referenceId,
            'description' => $description,
        ], $extra));

        $user->update(['wallet_balance' => $newBalance]);

        return $transaction;
    }

    /**
     * Pull-based settlement reconciliation for ONE pending gateway charge held
     * on a wallet row: a gateway tip charge ('tip_payment'), or — legacy — a
     * wallet top-up started before top-ups were retired.
     *
     * Two callers need it: the status endpoint the app polls after checkout,
     * and the scheduled sweep (errandguy:reconcile-topups) that catches the
     * customer who paid and never reopened the app.
     *
     * Deliberately narrow and additive:
     *   • no-op unless this is a pending top_up / tip_payment with a pullable
     *     gateway ref;
     *   • throttled per-transaction so a 3s poll can't hammer the gateway or
     *     drain the FPM pool;
     *   • settles ONLY through completeTopUp / expireTopUp or
     *     completeGatewayTip / expireGatewayTip — all row-locked, idempotent,
     *     and carrying their own settled-in-full guard — so this cannot credit
     *     twice or credit an under-settled charge;
     *   • only ever moves the row to the state the GATEWAY itself reports;
     *   • a gateway hiccup NEVER fails the caller (stays pending, retries next).
     *
     * @param  int|null  $throttleSeconds  null = the default polling window; 0 = bypass the throttle.
     */
    public function reconcilePendingTopUp(
        WalletTransaction $tx,
        ?int $throttleSeconds = null,
    ): WalletTransaction {
        // Gateway-funded TIPS settle through the identical shape — a pending row
        // plus a Payment Requests ref — but had no reconciliation on ANY path:
        // this method early-returned on them, the status poll routes tips here,
        // and no sweep covered them. One dropped webhook and the customer's tip
        // was captured at the gateway while the runner was never credited, with
        // no recovery, automated or manual. Same pull, same guards, settled by
        // the tip's own row-locked, idempotent completer below.
        if (! in_array($tx->type, ['top_up', 'tip_payment'], true)
            || $tx->status !== 'pending'
            || blank($tx->gateway_ref)) {
            return $tx;
        }

        // Only the DIRECT e-wallet charge (GCash/Maya) can be pulled: its
        // gateway_ref is a Payment Requests id ("pr-…"), which PaymentService
        // knows how to GET. A legacy hosted card invoice (from before cards
        // were retired) has no pull path and stays webhook-only.
        //
        // The prefix is a safe discriminator, not a guess: an invoice id is a
        // hex ObjectId, which cannot begin with "pr". If Xendit ever renamed
        // the prefix this would simply stop pulling and fall back to
        // webhook-only behaviour — it can never mis-address a lookup.
        if (! str_starts_with((string) $tx->gateway_ref, 'pr')) {
            return $tx;
        }

        // Cache::add is the throttle latch — it succeeds only when the key is
        // absent, so exactly one poll per window wins the pull and the rest
        // return the current DB state (kept live by the webhook).
        //
        // A window of 0 BYPASSES the latch, expressed as an explicit branch
        // rather than by passing 0 through to Cache::add — which returns false
        // for any non-positive TTL and would silently make the caller pull
        // nothing at all. The scheduled sweep uses the bypass: it runs exactly
        // where nobody is polling, and its own cadence and --limit bound
        // gateway load instead.
        $window = $throttleSeconds ?? self::RECONCILE_PULL_THROTTLE_SECONDS;
        if ($window > 0 && ! Cache::add("topup_reconcile_pull:{$tx->id}", 1, $window)) {
            return $tx;
        }

        try {
            $pr = app(PaymentService::class)->getPaymentRequest((string) $tx->gateway_ref);
        } catch (\Throwable $e) {
            // Gateway unreachable / not configured / transient — never fail the
            // caller; the webhook is still the primary settlement path.
            return $tx;
        }

        $gatewayStatus = strtoupper((string) ($pr['status'] ?? ''));

        $isTip = $tx->type === 'tip_payment';

        try {
            // PENDING / REQUIRES_ACTION → the customer hasn't finished paying.
            // Route to the settler that owns this row's money: a tip credits the
            // RUNNER and stamps booking.tip_amount, a top-up credits the
            // customer's own balance. Both are row-locked and idempotent.
            $settled = match ($gatewayStatus) {
                'SUCCEEDED' => $isTip
                    ? $this->completeGatewayTip($tx->id, $pr)
                    : $this->completeTopUp($tx->id, $pr),
                'FAILED' => $isTip
                    ? $this->expireGatewayTip($tx->id, 'Payment failed')
                    : $this->expireTopUp($tx->id, 'Payment failed'),
                'EXPIRED' => $isTip
                    ? $this->expireGatewayTip($tx->id, 'Payment window expired')
                    : $this->expireTopUp($tx->id, 'Payment window expired'),
                default => null,
            };
        } catch (\Throwable $e) {
            // A settlement error must never 500 a status poll.
            Log::warning('Xendit gateway-charge reconcile failed', [
                'transaction_id' => $tx->id,
                'type' => $tx->type,
                'error' => $e->getMessage(),
            ]);

            return $tx->fresh() ?? $tx;
        }

        return $settled ?? $tx;
    }

    /**
     * Pull-based settlement reconciliation for ONE pending PAYOUT.
     *
     * The money-OUT mirror of reconcilePendingTopUp, and the more painful of the
     * two: the wallet is debited the moment the payout row is created, and the
     * row then stays `pending` until payout.succeeded / payout.failed arrives.
     * With no pull path, a webhook that never lands means the money has left
     * the balance, nothing confirms it, and — because the app swaps the CTA to
     * "View payout status" whenever a pending payout exists — they cannot
     * request another one.
     *
     * Same shape and same guarantees as the top-up reconcile:
     *   • no-op unless this is a pending payout already handed to Xendit;
     *   • throttled per-transaction so a poll can't hammer the gateway;
     *   • settles ONLY through refreshSentPayout → completePayout / failPayout —
     *     both row-locked and pending-guarded, and failPayout is what re-credits
     *     the wallet — so this cannot double-pay or double-credit;
     *   • only ever moves the row to the state the GATEWAY itself reports;
     *   • a gateway hiccup never fails the caller (stays pending, retries later).
     *
     * @param  int|null  $throttleSeconds  null = the default polling window; 0 = bypass the throttle.
     */
    public function reconcilePendingPayout(
        WalletTransaction $tx,
        ?int $throttleSeconds = null,
    ): WalletTransaction {
        if ($tx->type !== 'payout' || $tx->status !== 'pending' || ! $tx->isSentToGateway()) {
            return $tx;
        }

        // See reconcilePendingTopUp: a window of 0 bypasses the latch via an
        // explicit branch, because Cache::add returns false for any
        // non-positive TTL and would silently pull nothing at all.
        $window = $throttleSeconds ?? self::RECONCILE_PULL_THROTTLE_SECONDS;
        if ($window > 0 && ! Cache::add("payout_reconcile_pull:{$tx->id}", 1, $window)) {
            return $tx;
        }

        return $this->refreshSentPayout($tx)['transaction'];
    }

    /**
     * How long a payout whose send went unanswered must wait before a
     * "Xendit has no record of it" lookup is believed. Xendit can take a
     * moment to show a payout it is still creating; reading that as "never
     * sent" and re-crediting the wallet is exactly the double payment this
     * guards against.
     */
    public const UNANSWERED_SEND_GRACE_MINUTES = 10;

    /**
     * Ask Xendit, now, what happened to a payout already handed to it, and
     * settle the row to match. Besides the webhook this is the ONLY way a sent
     * payout settles: the reconcile sweep, the wallet-list heal and staff
     * "Check with Xendit" all come through here, so a payout Xendit may have
     * paid is never marked failed on anyone's say-so but Xendit's.
     *
     * A payout whose send went unanswered has no Xendit id, so it is looked up
     * by the reference it was sent with. When Xendit has no record of it at
     * all, it was never created: with $releaseIfUnknown (staff only) and once
     * the grace window has passed, the "sent" mark is cleared so staff can send
     * it again (same idempotency key) or mark it failed.
     *
     * @return array{transaction: WalletTransaction, gateway_status: string}
     *   gateway_status is Xendit's status (SUCCEEDED, FAILED, ACCEPTED, …),
     *   NOT_FOUND when Xendit has no such payout, UNREACHABLE when the lookup
     *   itself failed, or NOT_SENT when there was nothing to look up.
     */
    public function refreshSentPayout(WalletTransaction $tx, bool $releaseIfUnknown = false): array
    {
        if ($tx->type !== 'payout' || $tx->status !== 'pending' || ! $tx->isSentToGateway()) {
            return ['transaction' => $tx, 'gateway_status' => 'NOT_SENT'];
        }

        $gateway = app(PaymentService::class);

        try {
            $payout = filled($tx->gateway_ref)
                ? $gateway->getPayout((string) $tx->gateway_ref)
                : $gateway->findPayoutByReference("payout-{$tx->id}");
        } catch (\Throwable $e) {
            // Gateway unreachable / not configured / transient — the webhook is
            // still the primary settlement path.
            return ['transaction' => $tx, 'gateway_status' => 'UNREACHABLE'];
        }

        if ($payout === null) {
            $released = false;
            if ($releaseIfUnknown && $tx->payout_sent_at?->lte(now()->subMinutes(self::UNANSWERED_SEND_GRACE_MINUTES))) {
                $released = WalletTransaction::whereKey($tx->id)
                    ->where('status', 'pending')
                    ->whereNull('gateway_ref')
                    ->update(['payout_sent_at' => null]) > 0;
            }

            return [
                'transaction' => $released ? ($tx->fresh() ?? $tx) : $tx,
                'gateway_status' => 'NOT_FOUND',
            ];
        }

        // An unanswered send that Xendit did create: keep its id from now on.
        if (blank($tx->gateway_ref) && filled($payout['id'] ?? null)) {
            WalletTransaction::whereKey($tx->id)->whereNull('gateway_ref')->update(['gateway_ref' => $payout['id']]);
            $tx->gateway_ref = $payout['id'];
        }

        $status = strtoupper((string) ($payout['status'] ?? ''));
        $reason = (string) ($payout['failure_code'] ?? 'Payout '.strtolower($status).' at gateway');

        try {
            // ACCEPTED / PENDING / LOCKED mean the disbursement is still in
            // flight at the gateway — nothing to settle yet.
            $settled = match ($status) {
                'SUCCEEDED' => $this->completePayout($tx->id),
                'FAILED', 'REVERSED', 'CANCELLED' => $this->failPayout($tx->id, $reason, confirmedByGateway: true),
                default => null,
            };
        } catch (\App\Exceptions\PayoutStateException) {
            // Settled by a racing webhook between our read and our write.
            return ['transaction' => $tx->fresh() ?? $tx, 'gateway_status' => $status];
        } catch (\Throwable $e) {
            Log::warning('Xendit payout reconcile failed', [
                'transaction_id' => $tx->id,
                'error' => $e->getMessage(),
            ]);

            return ['transaction' => $tx->fresh() ?? $tx, 'gateway_status' => $status];
        }

        if ($settled?->status === 'failed') {
            $this->notifyPayoutBounced($settled, $reason);
        }

        return ['transaction' => $settled ?? $tx, 'gateway_status' => $status];
    }

    /**
     * Legacy: complete a top-up started before top-ups were retired, once
     * Xendit confirms it was paid, so a customer who paid around the deploy
     * still gets their money. Nothing starts a top-up any more; delete this
     * (with expireTopUp and the webhook/sweep branches that call them) once no
     * pending top_up rows remain.
     *
     * Idempotent: a replayed webhook is a no-op after the first credit.
     */
    public function completeTopUp(string $transactionId, array $gatewayData = []): ?WalletTransaction
    {
        $justCompleted = false;

        $transaction = DB::transaction(function () use ($transactionId, $gatewayData, &$justCompleted) {
            $transaction = WalletTransaction::where('id', $transactionId)
                ->lockForUpdate()
                ->first();

            // Not found, or already completed/failed — nothing to do.
            if (!$transaction || $transaction->status !== 'pending' || $transaction->type !== 'top_up') {
                return $transaction;
            }

            // Settlement-amount tripwire (parity with XenditWebhookController::
            // verifySettledAmount on the booking path): the top-up invoice is
            // fixed-amount and created by us, so a divergence between what the
            // gateway confirms and what we recorded means a pricing/gateway bug
            // or tampering. Log-only — we still credit our recorded amount, but
            // ops get a reconciliation alarm instead of a silent credit.
            $confirmed = $gatewayData['paid_amount'] ?? $gatewayData['amount'] ?? null;
            if ($confirmed !== null) {
                $settled = (float) $confirmed;
                // Under-settled: the gateway confirmed LESS than the top-up we
                // recorded. Never credit the full amount — leave the top-up
                // pending for review instead of handing out uncollected balance
                // (payment review P0-9). Over-settlement is logged but allowed.
                if ($settled + 0.01 < (float) $transaction->amount) {
                    Log::critical('Xendit top-up settlement BELOW recorded amount — left pending, NOT credited', [
                        'transaction_id' => $transaction->id,
                        'user_id' => $transaction->user_id,
                        'expected' => (float) $transaction->amount,
                        'gateway_confirmed' => $settled,
                    ]);
                    return $transaction;
                }
                if (abs($settled - (float) $transaction->amount) > 0.01) {
                    Log::critical('Xendit top-up settlement amount mismatch (over-settled)', [
                        'transaction_id' => $transaction->id,
                        'user_id' => $transaction->user_id,
                        'expected' => (float) $transaction->amount,
                        'gateway_confirmed' => $settled,
                    ]);
                }
            }

            // withTrashed: a top-up can settle via webhook AFTER the user soft-
            // deleted their account; the money must still be booked to the ledger
            // (a plain findOrFail excludes soft-deleted rows → throws → 500-loops
            // the webhook, since the account row uses SoftDeletes).
            $user = User::withTrashed()->lockForUpdate()->findOrFail($transaction->user_id);
            $newBalance = (float) $user->wallet_balance + (float) $transaction->amount;
            $user->update(['wallet_balance' => $newBalance]);

            $transaction->update([
                'status' => 'completed',
                'balance_after' => $newBalance,
                'processed_at' => now(),
                'description' => 'Wallet top-up',
                'gateway_ref' => $gatewayData['id'] ?? $transaction->gateway_ref,
            ]);

            $justCompleted = true;
            return $transaction;
        });

        // Notify AFTER commit — never make an outbound push call inside the
        // lock. Only on the first (real) completion, so a replayed webhook
        // doesn't re-notify.
        if ($justCompleted && $transaction) {
            $amount = number_format((float) $transaction->amount, 2);
            $balance = number_format((float) $transaction->balance_after, 2);
            \App\Jobs\SendPushJob::dispatch(
                $transaction->user_id,
                'Top-up complete',
                "₱{$amount} was added to your wallet. New balance: ₱{$balance}.",
                [
                    'type' => 'payment',
                    'status' => 'completed',
                    'wallet_transaction_id' => $transaction->id,
                ],
            );
        }

        return $transaction;
    }

    /**
     * Legacy: mark a pending top-up failed because its charge expired or
     * failed before payment (see completeTopUp). Idempotent: a top-up that's
     * no longer pending is left untouched.
     */
    public function expireTopUp(string $transactionId, string $reason = 'Invoice expired'): ?WalletTransaction
    {
        return DB::transaction(function () use ($transactionId, $reason) {
            $transaction = WalletTransaction::where('id', $transactionId)
                ->lockForUpdate()
                ->first();

            if (!$transaction || $transaction->status !== 'pending' || $transaction->type !== 'top_up') {
                return $transaction;
            }

            $transaction->update([
                'status' => 'failed',
                'failure_reason' => $reason,
                'processed_at' => now(),
                'description' => 'Wallet top-up (expired)',
            ]);

            return $transaction;
        });
    }

    public function deduct(string $userId, float $amount, string $referenceId, string $description = 'Payment'): WalletTransaction
    {
        return DB::transaction(function () use ($userId, $amount, $referenceId, $description) {
            // Lock the user row FIRST so concurrent charges for the same wallet
            // serialize here; the idempotency check below is then reliable.
            $user = User::lockForUpdate()->findOrFail($userId);

            // Idempotency: a retried charge for the SAME reference is a no-op —
            // return the original debit instead of taking the money twice. The
            // uq_wallet_tx_reference_type index is the last-line DB guarantee if
            // this check is ever bypassed (e.g. by the other backend).
            $existing = WalletTransaction::where('user_id', $userId)
                ->where('reference_id', $referenceId)
                ->where('type', 'payment')
                ->first();
            if ($existing) {
                return $existing;
            }

            // Total spendable = withdrawable wallet + non-withdrawable bonus.
            $walletBalance = (float) $user->wallet_balance;
            $bonusBalance = (float) $user->bonus_balance;
            if ($walletBalance + $bonusBalance < $amount) {
                throw new \RuntimeException('Insufficient wallet balance.');
            }

            // Spend the non-withdrawable bonus FIRST, then withdrawable cash.
            // Recording bonusUsed lets a later refund return money to the same
            // bucket instead of laundering promo credit into withdrawable cash.
            $bonusUsed = min($bonusBalance, $amount);
            $walletUsed = $amount - $bonusUsed;

            $newBonus = $bonusBalance - $bonusUsed;
            $newBalance = $walletBalance - $walletUsed;
            $user->update(['wallet_balance' => $newBalance, 'bonus_balance' => $newBonus]);

            return WalletTransaction::create([
                'user_id' => $userId,
                'type' => 'payment',
                'amount' => -$amount,
                'bonus_portion' => $bonusUsed,
                'balance_after' => $newBalance,
                'reference_id' => $referenceId,
                'description' => $description,
            ]);
        });
    }

    /**
     * Customer tips their completed errand's runner. Atomic + idempotent (one
     * tip per booking, keyed on the booking id). Funded from the customer's
     * WITHDRAWABLE wallet balance ONLY — never promo bonus, since the tip is
     * real money paid to the runner — and credited straight to the runner's
     * withdrawable balance. The tip is a SEPARATE 'tip' transaction from the
     * fare, so a fare refund never touches it and it is never clawed back.
     *
     * @throws \RuntimeException  Insufficient balance, or the errand was already tipped.
     */
    public function tip(string $bookingId, string $customerId, string $runnerId, float $amount): void
    {
        DB::transaction(function () use ($bookingId, $customerId, $runnerId, $amount) {
            // Lock both wallets in a deterministic (sorted) order so this never
            // deadlocks against another two-wallet path.
            $ids = [$customerId, $runnerId];
            sort($ids);
            $users = User::whereIn('id', $ids)->lockForUpdate()->get()->keyBy('id');
            $customer = $users->get($customerId);
            $runner = $users->get($runnerId);
            if (! $customer || ! $runner) {
                throw new \RuntimeException('Customer or runner not found.');
            }

            // Idempotency: one tip per booking (the customer-side 'tip' debit is
            // the guard; the (user_id, reference_id, type) unique index backs it).
            $already = WalletTransaction::where('user_id', $customerId)
                ->where('reference_id', $bookingId)
                ->where('type', 'tip')
                ->exists();
            if ($already) {
                throw new \RuntimeException('This errand has already been tipped.');
            }

            // Tips come from withdrawable cash only, never promo bonus.
            if ((float) $customer->wallet_balance < $amount) {
                throw new \RuntimeException('Insufficient wallet balance for this tip.');
            }

            $customerNewBalance = (float) $customer->wallet_balance - $amount;
            $customer->update(['wallet_balance' => $customerNewBalance]);
            WalletTransaction::create([
                'user_id' => $customerId,
                'type' => 'tip',
                'amount' => -$amount,
                'balance_after' => $customerNewBalance,
                'reference_id' => $bookingId,
                'description' => 'Tip for your runner',
            ]);

            $runnerNewBalance = (float) $runner->wallet_balance + $amount;
            $runner->update(['wallet_balance' => $runnerNewBalance]);
            WalletTransaction::create([
                'user_id' => $runnerId,
                'type' => 'tip',
                'amount' => $amount,
                'balance_after' => $runnerNewBalance,
                'reference_id' => $bookingId,
                'description' => 'Tip from your customer',
            ]);

            Booking::whereKey($bookingId)->update(['tip_amount' => $amount]);
        });
    }

    /**
     * Start a GATEWAY-funded tip: the customer pays the tip directly with GCash
     * or Maya — no wallet balance required — and the runner is credited only
     * after Xendit confirms the charge. This is the zero-wallet / cash-errand
     * path the wallet-funded {@see self::tip()} can't serve.
     *
     * EVERY started charge gets its own pending 'tip_payment' row (its id keys
     * the gateway reference `tip-{id}`), linked to the errand by booking_id.
     * One row used to be reused for every attempt, so switching from GCash to
     * Maya overwrote the first charge's reference: approving that first charge
     * later took the customer's money and credited nobody. Now each charge
     * settles on its own row — the first to succeed credits the runner, and any
     * other that also succeeds is refunded to the customer's wallet (see
     * completeGatewayTip). The row is not a wallet movement (the money never
     * enters the customer's balance), so balance_after stays their current
     * balance.
     *
     * @throws \App\Exceptions\PaymentGatewayException on a gateway rejection.
     * @return array{transaction: WalletTransaction, checkout_url: ?string}
     */
    public function initiateGatewayTip(
        string $bookingId,
        string $customerId,
        float $amount,
        string $method,
        ?string $successRedirectUrl = null,
        ?string $failureRedirectUrl = null,
    ): array {
        if (! in_array($method, ['gcash', 'maya'], true)) {
            throw new \InvalidArgumentException('A gateway tip is paid with GCash or Maya.');
        }

        $customer = User::findOrFail($customerId);

        $transaction = WalletTransaction::create([
            'user_id' => $customerId,
            'type' => 'tip_payment',
            'booking_id' => $bookingId,
            'amount' => $amount,
            'balance_after' => (float) $customer->wallet_balance,
            'status' => 'pending',
            'description' => 'Tip (awaiting payment)',
        ]);

        try {
            $pr = app(PaymentService::class)->createPaymentRequest(
                $amount,
                "tip-{$transaction->id}",
                $method,
                'Tip for your runner',
                $successRedirectUrl,
                $failureRedirectUrl ?? $successRedirectUrl,
            );

            // Keep the charge reference even if there is no action to open, so
            // the charge stays traceable and reconcilable.
            $transaction->update(['gateway_ref' => $pr['id'] ?? null]);

            $checkoutUrl = PaymentService::extractActionUrl($pr);
            if (blank($checkoutUrl)) {
                throw new \RuntimeException('Gateway returned no authorization action for the e-wallet tip.');
            }

            $transaction->update(['checkout_url' => $checkoutUrl]);

            return ['transaction' => $transaction, 'checkout_url' => $checkoutUrl];
        } catch (\Throwable $e) {
            $transaction->update([
                'status' => 'failed',
                'failure_reason' => 'Could not start the tip payment.',
                'processed_at' => now(),
            ]);
            Log::error('Gateway tip: charge creation failed', [
                'transaction_id' => $transaction->id,
                'booking_id' => $bookingId,
                'method' => $method,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }

    /**
     * Settle a gateway tip charge once Xendit confirms it was paid.
     *
     * The charge was real money from the customer, so it ALWAYS ends somewhere
     * on the ledger — never silently dropped:
     *   • this row's charge, errand not yet tipped → credited to the RUNNER's
     *     withdrawable wallet (the same (runner, booking, 'tip') row shape the
     *     wallet-funded tip writes, so the unique index allows one per errand)
     *     and booking.tip_amount is stamped;
     *   • the errand was already tipped (another charge, or a wallet tip, got
     *     there first), or there is no runner to credit → the money is
     *     refunded to the customer's ErrandGuy wallet (withdrawable) and the
     *     row is marked 'refunded';
     *   • a charge that is NOT this row's own (an older app build reused one
     *     row for every attempt, overwriting the first charge's reference) →
     *     refunded to the customer's wallet too, keyed on that charge;
     *   • an under-settled charge is left pending (never credits short).
     *
     * Idempotent: the row is locked and settles once; each refund is keyed so a
     * replay can't refund twice. Customer and runner are told AFTER commit.
     */
    public function completeGatewayTip(string $transactionId, array $gatewayData = []): ?WalletTransaction
    {
        $notifyRunner = null; // [runnerId, amount, bookingNumber, bookingId]
        $notifyRefund = null; // [customerId, amount, refundTxId, why]

        $transaction = DB::transaction(function () use ($transactionId, $gatewayData, &$notifyRunner, &$notifyRefund) {
            $transaction = WalletTransaction::where('id', $transactionId)
                ->lockForUpdate()
                ->first();

            if (! $transaction || $transaction->type !== 'tip_payment') {
                return $transaction;
            }

            // Which charge is this? A Payment Requests webhook names both the
            // payment ("py-…", data.id) and its request ("pr-…"); a pull or an
            // invoice carries one id. Earlier deliveries may have stored either.
            $chargeRefs = array_values(array_filter([
                $gatewayData['payment_request_id'] ?? null,
                $gatewayData['id'] ?? null,
            ], 'is_string'));
            $isThisRowsCharge = $chargeRefs === [] || in_array($transaction->gateway_ref, $chargeRefs, true);
            $confirmed = $gatewayData['paid_amount'] ?? $gatewayData['amount'] ?? null;

            if (! $isThisRowsCharge) {
                $amount = round((float) ($confirmed ?? $transaction->amount), 2);
                $refund = $this->refundTipChargeLocked(
                    $transaction->user_id,
                    $amount,
                    (string) \Ramsey\Uuid\Uuid::uuid5(\Ramsey\Uuid\Uuid::NAMESPACE_URL, 'xendit-charge:'.$chargeRefs[0]),
                );
                if ($refund) {
                    $notifyRefund = [$transaction->user_id, $amount, $refund->id, 'This tip payment was replaced by a newer one'];
                    Log::critical('Gateway tip charge settled on a row it no longer owned — refunded to the customer wallet', [
                        'transaction_id' => $transaction->id,
                        'charge' => $chargeRefs[0],
                        'amount' => $amount,
                    ]);
                }

                return $transaction;
            }

            if ($transaction->status !== 'pending') {
                return $transaction; // a replay of the charge that already settled it
            }

            // Never credit a runner for LESS than the tip we recorded. A short
            // settle is left pending for the pull-reconciler / a human.
            if ($confirmed !== null && (float) $confirmed + 0.01 < (float) $transaction->amount) {
                Log::critical('Xendit gateway-tip settlement BELOW recorded amount — left pending, NOT credited', [
                    'transaction_id' => $transaction->id,
                    'booking_id' => $transaction->tipBookingId(),
                    'expected' => (float) $transaction->amount,
                    'gateway_confirmed' => (float) $confirmed,
                ]);

                return $transaction;
            }

            $amount = round((float) $transaction->amount, 2);
            $bookingId = (string) $transaction->tipBookingId();
            $booking = Booking::whereKey($bookingId)->lockForUpdate()->first();
            $settledRef = $transaction->gateway_ref ?? ($chargeRefs[0] ?? null);

            $alreadyTipped = $booking && $booking->runner_id && (
                (float) $booking->tip_amount > 0
                || WalletTransaction::where('user_id', $booking->runner_id)
                    ->where('reference_id', $bookingId)
                    ->where('type', 'tip')
                    ->exists()
            );

            if (! $booking || ! $booking->runner_id || $alreadyTipped) {
                $refund = $this->refundTipChargeLocked($transaction->user_id, $amount, $transaction->id);
                $transaction->update([
                    'status' => 'refunded',
                    'processed_at' => now(),
                    'gateway_ref' => $settledRef,
                    'description' => 'Tip (refunded to your wallet)',
                    'failure_reason' => $alreadyTipped
                        ? 'This errand was already tipped.'
                        : 'No runner to credit for this tip.',
                ]);
                if ($refund) {
                    $notifyRefund = [$transaction->user_id, $amount, $refund->id, $alreadyTipped
                        ? 'Your runner already has a tip for this errand'
                        : 'This errand has no runner to tip'];
                }

                return $transaction;
            }

            // Credit the runner — same shape as the wallet-funded tip so runner
            // earnings see an identical 'tip' transaction whatever the funding.
            // withTrashed: the tip can settle after the runner soft-deleted their
            // account; still book it to the ledger rather than 500-loop the hook.
            $runner = User::withTrashed()->lockForUpdate()->findOrFail($booking->runner_id);
            $this->applyLedgerDelta($runner, 'tip', $amount, $bookingId, 'Tip from your customer');

            $booking->update(['tip_amount' => $amount]);

            // The customer's ErrandGuy wallet did NOT move (they paid via the
            // gateway), so balance_after stays their current balance.
            $transaction->update([
                'status' => 'completed',
                'processed_at' => now(),
                'description' => 'Tip paid to your runner',
                'gateway_ref' => $settledRef,
            ]);

            $notifyRunner = [$booking->runner_id, $amount, $booking->booking_number, $booking->id];

            return $transaction;
        });

        // Notify AFTER commit (never push inside the lock), only on a real
        // credit or refund — a replayed webhook leaves both null.
        if ($notifyRunner) {
            [$runnerId, $amount, $bookingNumber, $bookingId] = $notifyRunner;
            \App\Jobs\SendPushJob::dispatch(
                $runnerId,
                'You received a tip!',
                'Your customer added a ₱'.number_format($amount, 2)." tip for errand #{$bookingNumber}.",
                ['type' => 'payment', 'booking_id' => (string) $bookingId],
            );
        }

        if ($notifyRefund) {
            [$customerId, $amount, $refundId, $why] = $notifyRefund;
            \App\Jobs\SendPushJob::dispatch(
                $customerId,
                'Tip refunded to your wallet',
                "{$why}, so this ₱".number_format($amount, 2)
                    .' payment was added to your ErrandGuy wallet. You can use it or withdraw it any time.',
                ['type' => 'payment', 'status' => 'refunded', 'wallet_transaction_id' => $refundId],
            );
            \App\Models\AdminAlert::raise(
                'tip_refunded',
                'warning',
                'Extra tip payment refunded to a customer wallet',
                'A ₱'.number_format($amount, 2).' GCash/Maya tip payment could not go to a runner ('.lcfirst($why)
                    .'), so it was credited back to the customer’s wallet automatically.',
                $refundId,
            );
        }

        return $transaction;
    }

    /**
     * Refund a collected tip charge to the customer's withdrawable wallet,
     * once per $reference. Runs inside the caller's transaction.
     *
     * @return WalletTransaction|null  the refund row, or null if this reference
     *                                 was already refunded
     */
    private function refundTipChargeLocked(string $customerId, float $amount, string $reference): ?WalletTransaction
    {
        $customer = User::withTrashed()->lockForUpdate()->findOrFail($customerId);

        $already = WalletTransaction::where('user_id', $customerId)
            ->where('reference_id', $reference)
            ->where('type', 'refund')
            ->exists();
        if ($already || $amount <= 0) {
            return null;
        }

        return $this->applyLedgerDelta($customer, 'refund', $amount, $reference, 'Refund: extra tip payment');
    }

    /**
     * Mark a pending gateway tip failed because its invoice expired / the charge
     * failed before payment. Idempotent: a non-pending tip_payment is untouched.
     */
    public function expireGatewayTip(string $transactionId, string $reason = 'Invoice expired'): ?WalletTransaction
    {
        return DB::transaction(function () use ($transactionId, $reason) {
            $transaction = WalletTransaction::where('id', $transactionId)
                ->lockForUpdate()
                ->first();

            if (! $transaction || $transaction->status !== 'pending' || $transaction->type !== 'tip_payment') {
                return $transaction;
            }

            $transaction->update([
                'status' => 'failed',
                'failure_reason' => $reason,
                'processed_at' => now(),
                'description' => 'Tip (payment not completed)',
            ]);

            return $transaction;
        });
    }

    /**
     * Largest single manual adjustment an admin can apply, in either direction.
     * A fat-finger guard — a genuinely larger correction is made in steps, which
     * also leaves a clearer audit trail.
     */
    public const MAX_ADJUSTMENT = 10000.0;

    /**
     * Admin manual wallet adjustment — a deliberate credit (+) or debit (−) to a
     * user's WITHDRAWABLE balance (never promo bonus). Money-safe: the user row
     * is locked, the magnitude is capped, and a debit can never overdraw the
     * wallet below zero. Records an audited 'adjustment' transaction carrying the
     * admin's reason. reference_id is intentionally NULL — an admin legitimately
     * adjusts the same user more than once, and the authoritative who/when audit
     * lives in AdminActivity (see the Filament action) — so this must NOT reuse
     * the (user, reference, type) idempotency key.
     *
     * @param  float  $signedAmount  Positive credits the user; negative debits.
     * @throws \RuntimeException on a zero / over-cap amount, an empty reason, or
     *                           an overdrawing debit.
     */
    public function adjust(string $userId, float $signedAmount, string $reason): WalletTransaction
    {
        $amount = round($signedAmount, 2);
        if ($amount === 0.0) {
            throw new \RuntimeException('Enter a non-zero amount.');
        }
        if (abs($amount) > self::MAX_ADJUSTMENT) {
            throw new \RuntimeException('A single adjustment is capped at ₱'.number_format(self::MAX_ADJUSTMENT, 2).'. Apply a larger correction in steps.');
        }
        $reason = trim($reason);
        if ($reason === '') {
            throw new \RuntimeException('A reason is required for a wallet adjustment.');
        }

        $justAdjusted = null; // [userId, amount, newBalance] set on success

        $transaction = DB::transaction(function () use ($userId, $amount, $reason, &$justAdjusted) {
            $user = User::lockForUpdate()->findOrFail($userId);

            $newBalance = round((float) $user->wallet_balance + $amount, 2);
            if ($newBalance < 0) {
                throw new \RuntimeException(
                    'This debit would overdraw the wallet — current balance is ₱'.number_format((float) $user->wallet_balance, 2).'.'
                );
            }
            $user->update(['wallet_balance' => $newBalance]);

            $tx = WalletTransaction::create([
                'user_id' => $userId,
                'type' => 'adjustment',
                'amount' => $amount, // signed: + credit, − debit
                'balance_after' => $newBalance,
                'description' => ($amount > 0 ? 'Credit adjustment' : 'Debit adjustment').': '.$reason,
            ]);

            $justAdjusted = [$userId, $amount, $newBalance];

            return $tx;
        });

        // Tell the user, honestly, AFTER commit (never push inside the lock).
        if ($justAdjusted) {
            [$uid, $amt, $newBalance] = $justAdjusted;
            $abs = number_format(abs($amt), 2);
            $bal = number_format($newBalance, 2);
            [$title, $body] = $amt > 0
                ? ['Wallet credited', "₱{$abs} was added to your wallet. New balance: ₱{$bal}. Reason: {$reason}"]
                : ['Wallet adjusted', "₱{$abs} was deducted from your wallet. New balance: ₱{$bal}. Reason: {$reason}"];
            \App\Jobs\SendPushJob::dispatch($uid, $title, $body, [
                'type' => 'payment',
                'wallet_transaction_id' => $transaction->id,
            ]);
        }

        return $transaction;
    }

    /**
     * Credit a refund, returning money to the SAME bucket it was spent from.
     *
     * @param  string       $referenceId     Idempotency + audit key for the refund row.
     * @param  string|null  $debitReference  Reference under which the ORIGINAL wallet
     *   payment debit was recorded, used to recover the bonus/withdrawable split.
     *   Defaults to $referenceId. These differ on the admin refund path: the wallet
     *   debit is keyed on the BOOKING id (BookingController::store), but the refund
     *   row is keyed on the PAYMENT id (PaymentService::refundToWallet) to stay
     *   idempotent-distinct from the lifecycle cancel refunds — so that caller MUST
     *   pass the booking id here or the split silently no-ops and bonus leaks into
     *   withdrawable cash (payment review follow-up).
     */
    public function refund(string $userId, float $amount, string $referenceId, ?string $debitReference = null): WalletTransaction
    {
        return DB::transaction(function () use ($userId, $amount, $referenceId, $debitReference) {
            // withTrashed: a charge can settle on a cancelled booking (auto-refund
            // via BookingSettlementService) AFTER the customer soft-deleted their
            // account — the refund must still be recorded and the payment marked
            // Refunded, not throw ModelNotFoundException and 500-loop the webhook.
            $user = User::withTrashed()->lockForUpdate()->findOrFail($userId);

            // Idempotency: a retried/double-tapped refund for the SAME reference
            // must not credit the wallet twice. This closes the cancel()
            // double-refund race; the uq_wallet_tx_reference_type index backs it.
            $existing = WalletTransaction::where('user_id', $userId)
                ->where('reference_id', $referenceId)
                ->where('type', 'refund')
                ->first();
            if ($existing) {
                return $existing;
            }

            // Return money to the SAME bucket it was spent from. Look up the
            // original wallet payment debit (keyed on $debitReference) to see how
            // much was withdrawable cash vs non-withdrawable bonus. Credit the
            // withdrawable wallet only up to what was withdrawable-spent; any
            // excess goes back to the non-withdrawable bonus balance. This
            // guarantees withdrawable-out ≤ withdrawable-in, so a refund can
            // never launder bonus credit into cashable balance. Gateway-funded
            // (card/GCash/Maya) bookings have no wallet debit → whole amount is
            // real money owed back → all to the withdrawable wallet.
            $debit = WalletTransaction::where('user_id', $userId)
                ->where('reference_id', $debitReference ?? $referenceId)
                ->where('type', 'payment')
                ->first();

            $walletRefund = $amount;
            $bonusRefund = 0.0;
            if ($debit) {
                $originalWalletUsed = abs((float) $debit->amount) - (float) $debit->bonus_portion;
                $walletRefund = min($amount, max(0.0, $originalWalletUsed));
                $bonusRefund = $amount - $walletRefund;
            }

            $newBalance = (float) $user->wallet_balance + $walletRefund;
            $newBonus = (float) $user->bonus_balance + $bonusRefund;
            $user->update(['wallet_balance' => $newBalance, 'bonus_balance' => $newBonus]);

            return WalletTransaction::create([
                'user_id' => $userId,
                'type' => 'refund',
                'amount' => $amount,
                'bonus_portion' => $bonusRefund,
                'balance_after' => $newBalance,
                'reference_id' => $referenceId,
                'description' => 'Refund',
            ]);
        });
    }

    /**
     * Debit a withdrawal and queue it as a PENDING payout — the one way money
     * leaves a wallet. Every entry point comes through here: a runner's payout
     * request, a customer's withdrawal, the payout queued while deleting an
     * account, and staff "Pay a runner". Staff then send it with "Send via
     * Xendit"; the payout webhook settles it (a failure re-credits the wallet).
     *
     * Money-safe:
     *   • the user row is locked, and the balance re-read under that lock, so
     *     two concurrent requests can't both pass a stale balance check;
     *   • only the WITHDRAWABLE balance can be paid out — bonus credit never;
     *   • $reference makes it idempotent: a second call with the same (user,
     *     reference) returns the original payout instead of debiting again,
     *     and the (user_id, reference_id, type) unique index backs that up;
     *   • the destination is recorded on the payout itself, so it can still be
     *     sent after the account's own details change or are erased.
     *
     * Safe to call inside a caller's transaction that already holds the user
     * row (account deletion): it then runs as a savepoint of that transaction.
     *
     * @param  string|null  $reference    stable idempotency token (uuid), or null
     * @param  array|null   $destination  see App\Support\PayoutDestination
     * @param  float        $minimum      the smallest payout allowed (0 = none)
     *
     * @throws \App\Exceptions\WithdrawalException before any money moves
     */
    public function createPendingPayout(
        string $userId,
        float $amount,
        ?string $reference,
        ?array $destination,
        float $minimum,
        string $description,
    ): WalletTransaction {
        $amount = round($amount, 2);

        return DB::transaction(function () use ($userId, $amount, $reference, $destination, $minimum, $description) {
            $user = User::lockForUpdate()->findOrFail($userId);

            // Idempotent replay: a payout already exists for this reference →
            // return it rather than debiting a second time.
            if ($reference !== null) {
                $existing = WalletTransaction::where('user_id', $userId)
                    ->where('reference_id', $reference)
                    ->where('type', 'payout')
                    ->first();
                if ($existing) {
                    return $existing;
                }
            }

            if ($amount <= 0) {
                throw \App\Exceptions\WithdrawalException::invalidAmount();
            }
            if ($minimum > 0 && $amount < $minimum) {
                throw \App\Exceptions\WithdrawalException::belowMinimum($minimum);
            }

            $balance = round((float) $user->wallet_balance, 2);
            if ($amount > $balance) {
                throw \App\Exceptions\WithdrawalException::insufficient($amount, $balance);
            }

            // 'pending' is explicit: the status column defaults to 'completed'
            // (right for system-earned rows), but a payout is not disbursed
            // until Xendit confirms, and createPayout refuses a non-pending row.
            return $this->applyLedgerDelta($user, 'payout', -$amount, $reference, $description, [
                'status' => 'pending',
                'payout_destination' => $destination,
            ]);
        });
    }

    /**
     * The configured payout minimum, applied to runners only. Customers can
     * withdraw any amount (their balance is refunds and the like, often small).
     */
    public static function runnerPayoutMinimum(): float
    {
        return (float) \App\Models\SystemConfig::getValue('min_payout_amount', '100');
    }

    /**
     * Staff-initiated payout ("Pay a runner"): debit + queue a pending payout,
     * with the runner minimum. See createPendingPayout.
     *
     * @param  string|null  $reference  per-modal idempotency token, so a
     *   double-submit can't double-debit + double-disburse (payment review P0-8).
     */
    public function payout(string $userId, float $amount, ?string $reference = null, ?array $destination = null): WalletTransaction
    {
        return $this->createPendingPayout(
            $userId,
            $amount,
            $reference,
            $destination,
            self::runnerPayoutMinimum(),
            'Payout to bank/e-wallet',
        );
    }

    /**
     * Mark a pending payout completed once funds have been disbursed.
     *
     * Shared money-safe path used by both AdminPayoutController and the
     * Filament Payouts page. Throws PayoutStateException if the payout is
     * not pending (callers surface a clean 422 / notification).
     */
    public function completePayout(string $txId): WalletTransaction
    {
        $tx = DB::transaction(function () use ($txId) {
            $tx = WalletTransaction::where('type', 'payout')
                ->lockForUpdate()
                ->findOrFail($txId);

            if ($tx->status !== 'pending') {
                throw new \App\Exceptions\PayoutStateException('Only pending payouts can be marked completed.');
            }

            $tx->update([
                'status' => 'completed',
                'processed_at' => now(),
            ]);

            return $tx->fresh();
        });

        // Notify the runner AFTER commit — best-effort, never inside the lock.
        $amount = number_format(abs((float) $tx->amount), 2);
        \App\Jobs\SendPushJob::dispatch(
            $tx->user_id,
            'Payout sent',
            "Your ₱{$amount} payout has been sent. It should arrive within 1–3 business days.",
            ['type' => 'payment', 'status' => 'completed', 'wallet_transaction_id' => $tx->id],
        );

        return $tx;
    }

    /**
     * Mark a pending payout failed and re-credit the wallet.
     *
     * The refund + status update are atomic so a bounced disbursement never
     * leaves the user double-debited.
     *
     * A payout already handed to Xendit can only be failed on Xendit's word
     * ($confirmedByGateway: the payout webhook or a fresh lookup in
     * refreshSentPayout). Marking one failed by hand re-credited the wallet
     * while Xendit went on to pay it — the same money paid out twice, with the
     * later "paid" notice ignored.
     */
    public function failPayout(string $txId, string $reason, bool $confirmedByGateway = false): WalletTransaction
    {
        return DB::transaction(function () use ($txId, $reason, $confirmedByGateway) {
            $tx = WalletTransaction::where('type', 'payout')
                ->lockForUpdate()
                ->findOrFail($txId);

            if ($tx->status !== 'pending') {
                throw new \App\Exceptions\PayoutStateException('Only pending payouts can be marked failed.');
            }

            if (! $confirmedByGateway && $tx->isSentToGateway()) {
                throw new \App\Exceptions\PayoutStateException(
                    'This payout was already sent to Xendit, so only Xendit can say it failed. '
                    .'Use “Check with Xendit” to get its current status.'
                );
            }

            // withTrashed: a payout.failed can arrive after the runner soft-
            // deleted their account; the re-credit still belongs on the ledger.
            $user = User::withTrashed()->lockForUpdate()->findOrFail($tx->user_id);
            // Re-credit the wallet using the same absolute amount that was
            // debited when the payout was requested.
            $refundAmount = abs((float) $tx->amount);
            $newBalance = (float) $user->wallet_balance + $refundAmount;

            WalletTransaction::create([
                'user_id' => $user->id,
                'type' => 'refund',
                'amount' => $refundAmount,
                'balance_after' => $newBalance,
                'reference_id' => $tx->id,
                'description' => 'Refund for failed payout',
                'status' => 'completed',
                'processed_at' => now(),
            ]);

            $user->update(['wallet_balance' => $newBalance]);

            $tx->update([
                'status' => 'failed',
                'processed_at' => now(),
                'failure_reason' => $reason,
            ]);

            return $tx->fresh();
        });
    }

    /**
     * Reverse a payout that had already been marked COMPLETED and then bounced
     * back from the gateway (Xendit `payout.reversed` / a late failure).
     *
     * failPayout() only re-credits a *pending* payout; a reversal that arrives
     * after the payout succeeded used to hit its pending-only guard and be
     * silently dropped, permanently debiting the runner for money that never
     * reached them (MONEYX-1). This re-credits the runner atomically and marks
     * the payout `reversed`.
     *
     * Idempotent: the re-credit refund row is keyed on the payout tx id, and a
     * second reversal (replayed webhook) finds it and no-ops. Throws
     * PayoutStateException if the payout is not in a reversible (completed) state
     * so the caller can fall back to failPayout for a still-pending payout.
     */
    public function reversePayout(string $txId, string $reason): WalletTransaction
    {
        return DB::transaction(function () use ($txId, $reason) {
            $tx = WalletTransaction::where('type', 'payout')
                ->lockForUpdate()
                ->findOrFail($txId);

            if ($tx->status === 'reversed') {
                return $tx; // already reversed — idempotent no-op
            }

            if ($tx->status !== 'completed') {
                throw new \App\Exceptions\PayoutStateException('Only a completed payout can be reversed.');
            }

            // Guard against a double re-credit if a refund row for this payout
            // already exists (e.g. a prior failPayout for the same tx).
            $alreadyCredited = WalletTransaction::where('user_id', $tx->user_id)
                ->where('reference_id', $tx->id)
                ->where('type', 'refund')
                ->exists();

            // withTrashed: a payout.reversed can arrive after the runner soft-
            // deleted their account; the re-credit still belongs on the ledger.
            $user = User::withTrashed()->lockForUpdate()->findOrFail($tx->user_id);

            if (! $alreadyCredited) {
                $refundAmount = abs((float) $tx->amount);
                $newBalance = (float) $user->wallet_balance + $refundAmount;

                WalletTransaction::create([
                    'user_id' => $user->id,
                    'type' => 'refund',
                    'amount' => $refundAmount,
                    'balance_after' => $newBalance,
                    'reference_id' => $tx->id,
                    'description' => 'Refund for reversed payout',
                    'status' => 'completed',
                    'processed_at' => now(),
                ]);

                $user->update(['wallet_balance' => $newBalance]);
            }

            $tx->update([
                'status' => 'reversed',
                'processed_at' => now(),
                'failure_reason' => $reason,
            ]);

            return $tx->fresh();
        });
    }

    /**
     * Tell the user their payout bounced, and that the money is back.
     *
     * completePayout() pushes "Payout sent"; without this the failure/reversal
     * paths only re-credited the wallet and wrote failure_reason, so the user
     * kept believing a transfer was in flight and then found their balance
     * mysteriously higher. In-app row + device push via SendPushJob, the same
     * `payment` type + wallet_transaction_id payload as the success push.
     *
     * MUST be called after the money transaction has committed (never inside
     * the lock). Latched per payout in the cache, so every path that settles a
     * payout into failed/reversed — the payout webhook, a fresh Xendit lookup,
     * staff "Mark failed" — can call it and the user still hears it once.
     */
    public function notifyPayoutBounced(WalletTransaction $tx, ?string $reason = null): void
    {
        // Cache::add is atomic: the first caller wins, everyone else no-ops.
        if (! Cache::add("payout_bounced_notified:{$tx->id}", true, now()->addDay())) {
            return;
        }

        $amount = number_format(abs((float) $tx->amount), 2);
        $reversed = $tx->status === 'reversed';
        $reason = \Illuminate\Support\Str::limit(trim((string) ($reason ?? $tx->failure_reason ?? '')), 140);

        $body = $reversed
            ? "Your ₱{$amount} payout was returned, so the money is back in your wallet."
            : "Your ₱{$amount} payout couldn’t be sent, so the money is back in your wallet.";

        if ($reason !== '') {
            $body .= " Reason: {$reason}.";
        }

        $body .= ' Check your payout details, then request it again.';

        \App\Jobs\SendPushJob::dispatch(
            $tx->user_id,
            $reversed ? 'Payout returned' : 'Payout couldn’t be sent',
            $body,
            [
                'type' => 'payment',
                'status' => $reversed ? 'reversed' : 'failed',
                'wallet_transaction_id' => $tx->id,
            ],
        );

        // A deleted account can't request it again (its contact details are
        // erased), so the money now sits in a closed wallet: staff must
        // re-send it to the destination recorded on the payout.
        if (User::onlyTrashed()->whereKey($tx->user_id)->exists()) {
            \App\Models\AdminAlert::raise(
                'payout_bounced_deleted_account',
                'critical',
                'A deleted account’s payout bounced',
                "A ₱{$amount} payout for a deleted account came back, so the money is in that closed wallet. "
                    .'Check the destination on the payout and send it again by hand.',
                $tx->id,
            );
        }
    }

    /**
     * Pay the runner the cancellation fee a customer was charged for cancelling
     * after the runner accepted (or set off to the pickup).
     *
     * The fee used to be kept by the platform, although it exists to
     * compensate the runner who accepted the job and may already be on the
     * way. Credited to their WITHDRAWABLE wallet as a 'cancel_fee' row, once
     * per booking (the (user, reference, type) unique index backs the check).
     *
     * CONTRACT: call inside the cancel transaction that holds the booking's row
     * lock, after the customer's refund. Returns the credit, or null when there
     * is nothing to pay (no runner, no fee, already paid, or a self-dealt
     * booking).
     */
    public function creditCancellationFee(Booking $booking, float $fee): ?WalletTransaction
    {
        $fee = round($fee, 2);
        if ($fee <= 0 || ! $booking->runner_id || (string) $booking->runner_id === (string) $booking->customer_id) {
            return null;
        }

        return DB::transaction(function () use ($booking, $fee) {
            $runner = User::withTrashed()->lockForUpdate()->find($booking->runner_id);
            if (! $runner) {
                return null;
            }

            $already = WalletTransaction::where('user_id', $runner->id)
                ->where('reference_id', $booking->id)
                ->where('type', 'cancel_fee')
                ->exists();
            if ($already) {
                return null;
            }

            return $this->applyLedgerDelta(
                $runner,
                'cancel_fee',
                $fee,
                $booking->id,
                "Cancellation fee for errand #{$booking->booking_number}",
            );
        });
    }
}
