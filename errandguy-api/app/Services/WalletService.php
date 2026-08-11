<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class WalletService
{
    public function getBalance(string $userId): float
    {
        return (float) User::where('id', $userId)->value('wallet_balance');
    }

    /**
     * Start a wallet top-up.
     *
     * Creates a PENDING transaction and a Xendit invoice, and returns both
     * (with the hosted checkout URL). The balance is DELIBERATELY NOT
     * credited here — money is only added once Xendit confirms payment via
     * the `invoice.paid` webhook (see completeTopUp). This closes the
     * previous "free money" hole where top-up credited the wallet with no
     * real charge.
     *
     * @return array{transaction: WalletTransaction, checkout_url: ?string}
     */
    public function initiateTopUp(
        string $userId,
        float $amount,
        ?string $payerEmail = null,
        ?string $successRedirectUrl = null,
        ?string $method = null,
        ?string $failureRedirectUrl = null,
    ): array {
        $user = User::findOrFail($userId);

        // Pending row first, so we have a stable id to key the charge's
        // external_id on. balance_after mirrors the CURRENT balance because
        // nothing has moved yet; it's rewritten when the webhook completes it.
        $transaction = WalletTransaction::create([
            'user_id' => $userId,
            'type' => 'top_up',
            'amount' => $amount,
            'balance_after' => (float) $user->wallet_balance,
            'status' => 'pending',
            'description' => 'Wallet top-up (awaiting payment)',
        ]);

        // GCash/Maya → direct Payment Requests charge: the action URL deep-links
        // straight into the wallet app, no Xendit hosted invoice page (mirrors
        // the booking checkout). Settles via the payment.succeeded webhook,
        // matched on the payment_request id we store as gateway_ref. Anything
        // else (card, or no method chosen) → the hosted invoice, which keeps
        // card/PCI inside Xendit and preserves the pre-selector behaviour.
        $isEwallet = in_array($method, ['gcash', 'maya'], true);

        try {
            if ($isEwallet) {
                $pr = app(PaymentService::class)->createPaymentRequest(
                    $amount,
                    "topup-{$transaction->id}",
                    $method,
                    'ErrandGuy wallet top-up',
                    $successRedirectUrl,
                    $failureRedirectUrl ?? $successRedirectUrl,
                );

                $checkoutUrl = PaymentService::extractActionUrl($pr);
                if (blank($checkoutUrl)) {
                    throw new \RuntimeException('Gateway returned no authorization action for the e-wallet top-up.');
                }

                $transaction->update([
                    'gateway_ref' => $pr['id'] ?? null,
                    'checkout_url' => $checkoutUrl,
                ]);

                return ['transaction' => $transaction, 'checkout_url' => $checkoutUrl];
            }

            $invoice = app(PaymentService::class)->createInvoice(
                $amount,
                "topup-{$transaction->id}",
                'ErrandGuy wallet top-up',
                $payerEmail ?? (string) ($user->email ?? ''),
                $successRedirectUrl,
            );

            $transaction->update([
                'gateway_ref' => $invoice['id'] ?? null,
                'checkout_url' => $invoice['invoice_url'] ?? null,
            ]);

            return [
                'transaction' => $transaction,
                'checkout_url' => $invoice['invoice_url'] ?? null,
            ];
        } catch (\Throwable $e) {
            // Couldn't reach the gateway — mark the pending row failed so it
            // doesn't linger as a fake "pending top-up" forever.
            $transaction->update([
                'status' => 'failed',
                'failure_reason' => 'Could not start the payment.',
                'processed_at' => now(),
            ]);
            Log::error('Wallet top-up: charge creation failed', [
                'transaction_id' => $transaction->id,
                'method' => $method,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }

    /**
     * Complete a top-up once Xendit confirms the invoice was paid.
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
     * Mark a pending top-up failed because its invoice expired before payment
     * (fired from the invoice.expired webhook). Idempotent: a top-up that's no
     * longer pending is left untouched.
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
     * Start a GATEWAY-funded tip: the customer pays the tip directly via an
     * online method (GCash/Maya/card) — no wallet balance required — and the
     * runner is credited only after Xendit confirms via webhook. This is the
     * zero-wallet / COD path that the wallet-funded {@see self::tip()} can't
     * serve.
     *
     * Mirrors {@see self::initiateTopUp()}: a pending 'tip_payment' row holds
     * the charge (its id keys the gateway external_id `tip-{id}`), then the
     * webhook flips it via {@see self::completeGatewayTip()}. The row is a
     * SINGLETON per (customer, booking) — the uq_wallet_tx_user_reference_type
     * index guarantees it — so we reuse/reset it across retries instead of
     * opening a second parallel charge. It is NOT a wallet movement (the money
     * never enters the customer's ErrandGuy balance), so its amount is recorded
     * for the receipt but balance_after stays the customer's untouched balance.
     *
     * @throws \App\Exceptions\PaymentGatewayException on a gateway rejection.
     * @return array{transaction: WalletTransaction, checkout_url: ?string}
     */
    public function initiateGatewayTip(
        string $bookingId,
        string $customerId,
        float $amount,
        string $method,
        ?string $payerEmail = null,
        ?string $successRedirectUrl = null,
        ?string $failureRedirectUrl = null,
    ): array {
        $customer = User::findOrFail($customerId);

        // Singleton per (customer, booking): reuse the existing 'tip_payment'
        // row (reset a terminal one back to pending) instead of inserting a
        // second — the unique index would otherwise reject the insert, and two
        // live charges could double-collect. balance_after mirrors the CURRENT
        // balance because a gateway tip never moves the customer's wallet.
        $transaction = WalletTransaction::firstOrNew([
            'user_id' => $customerId,
            'reference_id' => $bookingId,
            'type' => 'tip_payment',
        ]);
        $transaction->fill([
            'amount' => $amount,
            'balance_after' => (float) $customer->wallet_balance,
            'status' => 'pending',
            'description' => 'Tip (awaiting payment)',
            'gateway_ref' => null,
            'checkout_url' => null,
            'failure_reason' => null,
            'processed_at' => null,
        ]);
        $transaction->save();

        $description = 'Tip for your runner';
        $isEwallet = in_array($method, ['gcash', 'maya'], true);

        try {
            if ($isEwallet) {
                $pr = app(PaymentService::class)->createPaymentRequest(
                    $amount,
                    "tip-{$transaction->id}",
                    $method,
                    $description,
                    $successRedirectUrl,
                    $failureRedirectUrl ?? $successRedirectUrl,
                );

                $checkoutUrl = PaymentService::extractActionUrl($pr);
                if (blank($checkoutUrl)) {
                    throw new \RuntimeException('Gateway returned no authorization action for the e-wallet tip.');
                }

                $transaction->update([
                    'gateway_ref' => $pr['id'] ?? null,
                    'checkout_url' => $checkoutUrl,
                ]);

                return ['transaction' => $transaction, 'checkout_url' => $checkoutUrl];
            }

            $invoice = app(PaymentService::class)->createInvoice(
                $amount,
                "tip-{$transaction->id}",
                $description,
                $payerEmail ?? (string) ($customer->email ?? ''),
                $successRedirectUrl,
            );

            $transaction->update([
                'gateway_ref' => $invoice['id'] ?? null,
                'checkout_url' => $invoice['invoice_url'] ?? null,
            ]);

            return [
                'transaction' => $transaction,
                'checkout_url' => $invoice['invoice_url'] ?? null,
            ];
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
     * Settle a gateway-funded tip once Xendit confirms payment. Credits the
     * RUNNER's wallet (never the customer's — the customer paid real money that
     * never entered their ErrandGuy balance) and stamps booking.tip_amount.
     *
     * Idempotent + money-safe, mirroring {@see self::completeTopUp()}:
     *   • the pending 'tip_payment' row is row-locked and only settled once;
     *   • an under-settlement is left pending (never credits short);
     *   • the runner credit is the SAME (runner, booking, 'tip') row shape the
     *     wallet-funded tip writes — the unique index guarantees the runner is
     *     credited at most once per booking regardless of funding source;
     *   • a booking that is somehow already tipped is NOT double-credited — the
     *     collected charge is flagged CRITICAL for a manual refund instead.
     */
    public function completeGatewayTip(string $transactionId, array $gatewayData = []): ?WalletTransaction
    {
        $notify = null; // [runnerId, amount, bookingNumber] set only on a real credit

        $transaction = DB::transaction(function () use ($transactionId, $gatewayData, &$notify) {
            $transaction = WalletTransaction::where('id', $transactionId)
                ->lockForUpdate()
                ->first();

            if (! $transaction || $transaction->status !== 'pending' || $transaction->type !== 'tip_payment') {
                return $transaction;
            }

            // Never credit a runner for LESS than the tip we recorded. A short
            // settle is left pending for the pull-reconciler / a human.
            $confirmed = $gatewayData['paid_amount'] ?? $gatewayData['amount'] ?? null;
            if ($confirmed !== null && (float) $confirmed + 0.01 < (float) $transaction->amount) {
                Log::critical('Xendit gateway-tip settlement BELOW recorded amount — left pending, NOT credited', [
                    'transaction_id' => $transaction->id,
                    'booking_id' => $transaction->reference_id,
                    'expected' => (float) $transaction->amount,
                    'gateway_confirmed' => (float) $confirmed,
                ]);
                return $transaction;
            }

            $amount = round((float) $transaction->amount, 2);
            $bookingId = (string) $transaction->reference_id;
            $booking = Booking::whereKey($bookingId)->lockForUpdate()->first();

            if (! $booking || ! $booking->runner_id) {
                $transaction->update([
                    'status' => 'failed',
                    'failure_reason' => 'No runner to credit for this tip.',
                    'processed_at' => now(),
                    'gateway_ref' => $gatewayData['id'] ?? $transaction->gateway_ref,
                ]);
                return $transaction;
            }

            // Duplicate guard: if this errand was somehow already tipped (a
            // racing wallet tip, or a second gateway charge), do NOT credit the
            // runner twice. The charge WAS collected, so the row is marked
            // completed, but a CRITICAL alarm flags it for a manual refund.
            $alreadyTipped = (float) $booking->tip_amount > 0
                || WalletTransaction::where('user_id', $booking->runner_id)
                    ->where('reference_id', $bookingId)
                    ->where('type', 'tip')
                    ->exists();
            if ($alreadyTipped) {
                Log::critical('Gateway tip collected for an already-tipped errand — MANUAL REFUND REQUIRED', [
                    'transaction_id' => $transaction->id,
                    'booking_id' => $bookingId,
                    'customer_id' => $transaction->user_id,
                    'amount' => $amount,
                ]);
                $transaction->update([
                    'status' => 'completed',
                    'processed_at' => now(),
                    'description' => 'Tip (duplicate — refund pending)',
                    'failure_reason' => 'Duplicate tip payment — refund required.',
                    'gateway_ref' => $gatewayData['id'] ?? $transaction->gateway_ref,
                ]);
                return $transaction;
            }

            // Credit the runner — same shape as the wallet-funded tip so runner
            // earnings see an identical 'tip' transaction whatever the funding.
            // withTrashed: the tip can settle after the runner soft-deleted their
            // account; still book it to the ledger rather than 500-loop the hook.
            $runner = User::withTrashed()->lockForUpdate()->findOrFail($booking->runner_id);
            $runnerNewBalance = (float) $runner->wallet_balance + $amount;
            $runner->update(['wallet_balance' => $runnerNewBalance]);
            WalletTransaction::create([
                'user_id' => $booking->runner_id,
                'type' => 'tip',
                'amount' => $amount,
                'balance_after' => $runnerNewBalance,
                'reference_id' => $bookingId,
                'description' => 'Tip from your customer',
            ]);

            $booking->update(['tip_amount' => $amount]);

            // The customer's ErrandGuy wallet did NOT move (they paid via the
            // gateway), so balance_after stays their current balance.
            $transaction->update([
                'status' => 'completed',
                'processed_at' => now(),
                'description' => 'Tip paid to your runner',
                'gateway_ref' => $gatewayData['id'] ?? $transaction->gateway_ref,
            ]);

            $notify = [$booking->runner_id, $amount, $booking->booking_number];
            return $transaction;
        });

        // Notify the runner AFTER commit (never push inside the lock), only on a
        // real credit — a replayed webhook leaves $notify null.
        if ($notify) {
            [$runnerId, $amount, $bookingNumber] = $notify;
            \App\Jobs\SendPushJob::dispatch(
                $runnerId,
                'You received a tip!',
                'Your customer added a ₱'.number_format($amount, 2)." tip for errand #{$bookingNumber}.",
                ['type' => 'payment', 'booking_id' => (string) $transaction?->reference_id],
            );
        }

        return $transaction;
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
     * Debit the wallet and create a pending payout (admin-initiated path).
     *
     * @param  string|null  $reference  Stable idempotency token. When supplied, a
     *   second call with the same (user, reference) returns the original payout
     *   instead of debiting again — the DB backstop is the partial unique index
     *   on (user_id, reference_id, type). The admin "Pay a runner" form threads a
     *   per-modal token so a double-submit can't double-debit + double-disburse
     *   (payment review P0-8 follow-up). NULL preserves the legacy behaviour.
     */
    public function payout(string $userId, float $amount, ?string $reference = null): WalletTransaction
    {
        return DB::transaction(function () use ($userId, $amount, $reference) {
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

            $minPayout = 100.0;
            if ($amount < $minPayout) {
                throw new \RuntimeException("Minimum payout amount is ₱{$minPayout}.");
            }

            if ((float) $user->wallet_balance < $amount) {
                throw new \RuntimeException('Insufficient wallet balance.');
            }

            $newBalance = (float) $user->wallet_balance - $amount;
            $user->update(['wallet_balance' => $newBalance]);

            return WalletTransaction::create([
                'user_id' => $userId,
                'type' => 'payout',
                // A payout is 'pending' until it is actually disbursed. The status
                // column DEFAULTS to 'completed' (correct for system-earned rows),
                // so it MUST be set explicitly here — otherwise createPayout()
                // rejects the row ('Only a pending payout can be sent.') AFTER this
                // debit is already committed in its own transaction, losing the
                // runner's money with no recovery (complete/fail/re-send are all
                // gated on status='pending'). Mirrors the runner-request path
                // (RunnerPayoutController), which sets 'pending' explicitly.
                'status' => 'pending',
                'amount' => -$amount,
                'balance_after' => $newBalance,
                'reference_id' => $reference,
                'description' => 'Payout to bank/e-wallet',
            ]);
        });
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
     * Mark a pending payout failed and re-credit the runner's wallet.
     *
     * The refund + status update are atomic so a bounced disbursement never
     * leaves the runner double-debited. Mirrors the original
     * AdminPayoutController::markFailed logic exactly.
     */
    public function failPayout(string $txId, string $reason): WalletTransaction
    {
        return DB::transaction(function () use ($txId, $reason) {
            $tx = WalletTransaction::where('type', 'payout')
                ->lockForUpdate()
                ->findOrFail($txId);

            if ($tx->status !== 'pending') {
                throw new \App\Exceptions\PayoutStateException('Only pending payouts can be marked failed.');
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
}
