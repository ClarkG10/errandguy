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
            $user = User::lockForUpdate()->findOrFail($userId);

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
}
