<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Requests\Runner\PayoutRequest;
use App\Models\SystemConfig;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class RunnerPayoutController extends Controller
{
    public function requestPayout(PayoutRequest $request): JsonResponse
    {
        $user = $request->user();
        $profile = $user->runnerProfile;

        if (!$profile) {
            return response()->json([
                'message' => 'Runner profile not found.',
            ], 404);
        }

        // Check payout method is configured
        if (!$profile->bank_name && !$profile->ewallet_number) {
            return response()->json([
                'message' => 'Please configure a bank account or e-wallet before requesting a payout.',
            ], 422);
        }

        $amount = (float) $request->validated('amount');
        $minPayout = (float) SystemConfig::getValue('min_payout_amount', '100');

        if ($amount < $minPayout) {
            return response()->json([
                'message' => "Minimum payout amount is ₱{$minPayout}.",
            ], 422);
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
            return response()->json([
                'message' => 'Insufficient wallet balance.',
            ], 422);
        }

        return response()->json([
            'data' => $transaction,
            'message' => "Payout of ₱{$amount} has been requested.",
        ]);
    }
}
