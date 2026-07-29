<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Requests\Runner\PayoutRequest;
use App\Models\SystemConfig;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Support\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class RunnerPayoutController extends Controller
{
    public function requestPayout(PayoutRequest $request): JsonResponse
    {
        $user = $request->user();
        $profile = $user->runnerProfile;

        if (!$profile) {
            return $this->fail(ErrorCode::NOT_FOUND, 'We couldn’t find your runner profile. Please contact support.', 404);
        }

        // Check payout method is configured
        if (!$profile->bank_name && !$profile->ewallet_number) {
            return $this->fail(
                ErrorCode::PAYOUT_METHOD_REQUIRED,
                'Add a bank account or e-wallet in your payout settings before requesting a payout.',
            );
        }

        $amount = (float) $request->validated('amount');
        $minPayout = (float) SystemConfig::getValue('min_payout_amount', '100');

        if ($amount < $minPayout) {
            return $this->fail(
                ErrorCode::PAYOUT_MIN_AMOUNT,
                'The minimum payout is ₱'.number_format($minPayout, 2).'. Please request at least that amount.',
            );
        }

        // The Idempotency-Key (guaranteed present by `idempotent:required`)
        // becomes the payout's stable reference_id. That turns the partial
        // unique index (user_id, reference_id, type) into a hard DB backstop
        // against a double-debit even if the HTTP idempotency layer is ever
        // bypassed (e.g. the other backend) — payouts previously carried a
        // NULL reference and were excluded from that guard entirely (P0-8).
        $reference = (string) $request->header('Idempotency-Key');

        // Atomic balance check + debit. Re-reading the balance INSIDE the
        // transaction with lockForUpdate prevents two concurrent payout
        // requests from both passing a stale balance check and draining
        // the wallet below zero.
        try {
            $transaction = DB::transaction(function () use ($user, $amount, $reference) {
                $locked = User::whereKey($user->id)->lockForUpdate()->firstOrFail();

                // Idempotent replay: a payout already exists for this reference
                // → return it instead of debiting a second time.
                $existing = WalletTransaction::where('user_id', $locked->id)
                    ->where('reference_id', $reference)
                    ->where('type', 'payout')
                    ->first();
                if ($existing) {
                    return $existing;
                }

                $balance = (float) $locked->wallet_balance;

                if ($amount > $balance) {
                    throw new \RuntimeException('insufficient');
                }

                $newBalance = $balance - $amount;

                $tx = WalletTransaction::create([
                    'user_id' => $locked->id,
                    'type' => 'payout',
                    'amount' => -$amount,
                    'balance_after' => $newBalance,
                    'reference_id' => $reference,
                    'description' => 'Payout request',
                    'status' => 'pending',
                ]);

                $locked->update(['wallet_balance' => $newBalance]);

                return $tx;
            });
        } catch (\RuntimeException $e) {
            $balance = number_format((float) $user->fresh()->wallet_balance, 2);

            return $this->fail(
                ErrorCode::INSUFFICIENT_WALLET_BALANCE,
                "You requested ₱".number_format($amount, 2)." but your available balance is ₱{$balance}. Lower the amount and try again.",
            );
        }

        $destination = $profile->bank_name
            ? "your {$profile->bank_name} account"
            : 'your e-wallet';

        return $this->ok(
            $transaction,
            "Payout of ₱".number_format($amount, 2)." to {$destination} requested. We’ll review it and notify you once it’s on the way.",
        );
    }
}
