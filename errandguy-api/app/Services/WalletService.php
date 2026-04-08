<?php

namespace App\Services;

use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Support\Facades\DB;

class WalletService
{
    public function getBalance(string $userId): float
    {
        return (float) User::where('id', $userId)->value('wallet_balance');
    }

    public function topUp(string $userId, float $amount, string $referenceId): WalletTransaction
    {
        return DB::transaction(function () use ($userId, $amount, $referenceId) {
            $user = User::lockForUpdate()->findOrFail($userId);

            $newBalance = (float) $user->wallet_balance + $amount;
            $user->update(['wallet_balance' => $newBalance]);

            return WalletTransaction::create([
                'user_id' => $userId,
                'type' => 'top_up',
                'amount' => $amount,
                'balance_after' => $newBalance,
                'reference_id' => $referenceId,
                'description' => 'Wallet top-up',
            ]);
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
