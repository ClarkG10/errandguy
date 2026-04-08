<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Requests\Runner\PayoutRequest;
use App\Models\SystemConfig;
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
        $walletBalance = (float) $user->wallet_balance;

        if ($amount < $minPayout) {
            return response()->json([
                'message' => "Minimum payout amount is ₱{$minPayout}.",
            ], 422);
        }

        if ($amount > $walletBalance) {
            return response()->json([
                'message' => 'Insufficient wallet balance.',
            ], 422);
        }

        $transaction = DB::transaction(function () use ($user, $amount, $walletBalance) {
            $newBalance = $walletBalance - $amount;

            $transaction = WalletTransaction::create([
                'user_id' => $user->id,
                'type' => 'payout',
                'amount' => -$amount,
                'balance_after' => $newBalance,
                'description' => 'Payout request',
            ]);

            $user->update(['wallet_balance' => $newBalance]);

            return $transaction;
        });

        return response()->json([
            'data' => $transaction,
            'message' => "Payout of ₱{$amount} has been requested.",
        ]);
    }
}
