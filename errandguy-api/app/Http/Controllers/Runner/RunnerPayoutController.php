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

        // Atomic balance check + debit. Re-reading the balance INSIDE the
        // transaction with lockForUpdate prevents two concurrent payout
        // requests from both passing a stale balance check and draining
        // the wallet below zero.
        try {
            $transaction = DB::transaction(function () use ($user, $amount) {
                $locked = User::whereKey($user->id)->lockForUpdate()->firstOrFail();
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
