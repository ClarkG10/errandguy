<?php

namespace App\Services;

use App\Models\Referral;
use App\Models\SystemConfig;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ReferralService
{
    public function __construct(
        private NotificationService $notificationService,
    ) {}

    /**
     * Generate a unique, collision-safe 8-character uppercase referral code.
     * Excludes ambiguous characters (0/O, 1/I) so codes are easy to read
     * and type from a shared screenshot.
     */
    public function generateCode(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

        do {
            $code = '';
            for ($i = 0; $i < 8; $i++) {
                $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
        } while (User::where('referral_code', $code)->exists());

        return $code;
    }

    /**
     * Attach a referee to a referrer using the referrer's code.
     *
     * Validates the code exists, the referee isn't referring themselves,
     * and the referee hasn't already been referred. Creates a 'pending'
     * Referral row and stamps the referee's `referred_by`.
     *
     * @throws \RuntimeException with a machine key: 'invalid_code' |
     *         'self_referral' | 'already_referred'
     */
    public function attach(string $refereeId, string $code): Referral
    {
        $code = strtoupper(trim($code));

        return DB::transaction(function () use ($refereeId, $code) {
            $referrer = User::where('referral_code', $code)->first();
            if (!$referrer) {
                throw new \RuntimeException('invalid_code');
            }

            if ($referrer->id === $refereeId) {
                throw new \RuntimeException('self_referral');
            }

            $referee = User::lockForUpdate()->findOrFail($refereeId);

            // Already referred — either the column is set or a referral row
            // already exists (unique referee_id enforces this at the DB too).
            if ($referee->referred_by
                || Referral::where('referee_id', $refereeId)->exists()) {
                throw new \RuntimeException('already_referred');
            }

            $referral = Referral::create([
                'referrer_id' => $referrer->id,
                'referee_id' => $refereeId,
                'status' => 'pending',
            ]);

            $referee->update(['referred_by' => $referrer->id]);

            return $referral;
        });
    }

    /**
     * Reward a completed referral on the referee's FIRST completed booking.
     *
     * Idempotent: locks the pending Referral row and no-ops if it's already
     * been rewarded (or doesn't exist). Credits a wallet bonus to BOTH the
     * referrer and the referee using the same lock-balance-then-write idiom
     * as RunnerErrandController::handleCompletion.
     */
    public function reward(string $refereeId): ?Referral
    {
        $rewarded = DB::transaction(function () use ($refereeId) {
            $referral = Referral::where('referee_id', $refereeId)
                ->lockForUpdate()
                ->first();

            // No referral, or already rewarded — nothing to do.
            if (!$referral || $referral->status === 'rewarded') {
                return null;
            }

            $amount = (float) SystemConfig::getValue('referral_reward_amount', 50);

            $this->creditBonus(
                $referral->referrer_id,
                $amount,
                $referral->id,
                'ErrandGuy referral reward — your friend completed their first errand!',
            );
            $this->creditBonus(
                $referral->referee_id,
                $amount,
                $referral->id,
                'ErrandGuy welcome reward — thanks for joining via a referral!',
            );

            $referral->update([
                'status' => 'rewarded',
                'reward_amount' => $amount,
                'qualified_at' => $referral->qualified_at ?? now(),
                'rewarded_at' => now(),
            ]);

            return $referral;
        });

        if ($rewarded) {
            $amount = (float) $rewarded->reward_amount;
            $this->notificationService->sendPush(
                $rewarded->referrer_id,
                'Referral Reward!',
                "You earned ₱{$amount} — your friend completed their first errand.",
                ['type' => 'referral', 'referral_id' => $rewarded->id],
            );
            $this->notificationService->sendPush(
                $rewarded->referee_id,
                'Welcome Bonus!',
                "You earned ₱{$amount} for joining ErrandGuy through a referral.",
                ['type' => 'referral', 'referral_id' => $rewarded->id],
            );
        }

        return $rewarded;
    }

    /**
     * Credit a wallet bonus, mirroring the balance-lock idiom in
     * RunnerErrandController::handleCompletion. Assumes it runs inside a
     * surrounding DB transaction.
     */
    private function creditBonus(string $userId, float $amount, string $referenceId, string $description): void
    {
        $user = User::lockForUpdate()->find($userId);
        if (!$user) {
            return;
        }

        $newBalance = (float) $user->wallet_balance + $amount;

        WalletTransaction::create([
            'user_id' => $user->id,
            'type' => 'bonus',
            'amount' => $amount,
            'balance_after' => $newBalance,
            'reference_id' => $referenceId,
            'description' => $description,
        ]);

        $user->update(['wallet_balance' => $newBalance]);
    }
}
