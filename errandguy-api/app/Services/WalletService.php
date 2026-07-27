<?php

namespace App\Services;

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
    public function initiateTopUp(string $userId, float $amount, ?string $payerEmail = null, ?string $successRedirectUrl = null): array
    {
        $user = User::findOrFail($userId);

        // Pending row first, so we have a stable id to key the invoice's
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

        try {
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
                'failure_reason' => 'Could not create payment invoice.',
                'processed_at' => now(),
            ]);
            Log::error('Wallet top-up: invoice creation failed', [
                'transaction_id' => $transaction->id,
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
            if ($confirmed !== null && abs((float) $confirmed - (float) $transaction->amount) > 0.01) {
                Log::critical('Xendit top-up settlement amount mismatch', [
                    'transaction_id' => $transaction->id,
                    'user_id' => $transaction->user_id,
                    'expected' => (float) $transaction->amount,
                    'gateway_confirmed' => (float) $confirmed,
                ]);
            }

            $user = User::lockForUpdate()->findOrFail($transaction->user_id);
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
            app(NotificationService::class)->sendPush(
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

            if ((float) $user->wallet_balance < $amount) {
                throw new \RuntimeException('Insufficient wallet balance.');
            }

            $newBalance = (float) $user->wallet_balance - $amount;
            $user->update(['wallet_balance' => $newBalance]);

            return WalletTransaction::create([
                'user_id' => $userId,
                'type' => 'payment',
                'amount' => -$amount,
                'balance_after' => $newBalance,
                'reference_id' => $referenceId,
                'description' => $description,
            ]);
        });
    }

    public function refund(string $userId, float $amount, string $referenceId): WalletTransaction
    {
        return DB::transaction(function () use ($userId, $amount, $referenceId) {
            $user = User::lockForUpdate()->findOrFail($userId);

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

            $newBalance = (float) $user->wallet_balance + $amount;
            $user->update(['wallet_balance' => $newBalance]);

            return WalletTransaction::create([
                'user_id' => $userId,
                'type' => 'refund',
                'amount' => $amount,
                'balance_after' => $newBalance,
                'reference_id' => $referenceId,
                'description' => 'Refund',
            ]);
        });
    }

    public function payout(string $userId, float $amount): WalletTransaction
    {
        return DB::transaction(function () use ($userId, $amount) {
            $user = User::lockForUpdate()->findOrFail($userId);

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
                'amount' => -$amount,
                'balance_after' => $newBalance,
                'reference_id' => null,
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
        return DB::transaction(function () use ($txId) {
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

            $user = User::lockForUpdate()->findOrFail($tx->user_id);
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
}
