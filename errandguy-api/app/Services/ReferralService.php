<?php

namespace App\Services;

use App\Models\Referral;
use App\Models\SystemConfig;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Support\Facades\DB;

class ReferralService
{
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
     * Reward a completed referral once the referee makes their first REAL,
     * PAID, NON-CASH booking (P0-6).
     *
     * Two abuse guards live here, not just in the caller, so every path
     * (listener, admin manual reward) is protected:
     *
     *  1. Qualification gate — the referee must have a completed booking that
     *     was actually settled online (a completed non-cash Payment). Cash
     *     bookings move no money through the platform, so rewarding them let
     *     an account farm bonuses off fake cash errands. If the referee hasn't
     *     qualified yet, this no-ops and leaves the referral pending so it can
     *     still reward on a later genuine booking.
     *  2. Per-referrer cap — once a referrer has earned the configured number
     *     of referral rewards, further referrals still welcome the referee but
     *     stop paying the referrer, bounding mass alt-account farming.
     *
     * Bonuses are non-withdrawable (see creditBonus), so even a reward that
     * slips both guards can never be cashed out. Idempotent: locks the
     * referral row and no-ops if already rewarded.
     */
    public function reward(string $refereeId): ?Referral
    {
        $referrerCredited = false;

        $rewarded = DB::transaction(function () use ($refereeId, &$referrerCredited) {
            $referral = Referral::where('referee_id', $refereeId)
                ->lockForUpdate()
                ->first();

            // No referral, or already rewarded — nothing to do.
            if (!$referral || $referral->status === 'rewarded') {
                return null;
            }

            // Gate 1: the referee must have a genuinely paid, non-cash errand.
            if (!$this->hasQualifyingBooking($refereeId)) {
                return null;
            }

            // Lock BOTH wallet rows up front, in a deterministic (sorted) order.
            // - Consistent ordering avoids a deadlock when a reciprocal referral
            //   pair (A→B and B→A) is rewarded concurrently and would otherwise
            //   grab the two User rows in opposite orders.
            // - Locking the referrer row here also serializes concurrent rewards
            //   for the SAME referrer, so the per-referrer cap count below is read
            //   under that lock and can't be raced past the cap by sibling jobs.
            $lockIds = [$referral->referrer_id, $referral->referee_id];
            sort($lockIds);
            foreach ($lockIds as $lockId) {
                User::whereKey($lockId)->lockForUpdate()->first();
            }

            $amount = (float) SystemConfig::getValue('referral_reward_amount', 50);

            // Gate 2: stop paying a referrer who has already hit the cap.
            $maxPerReferrer = (int) SystemConfig::getValue('referral_max_rewards_per_referrer', 50);
            $referrerRewarded = Referral::where('referrer_id', $referral->referrer_id)
                ->where('status', 'rewarded')
                ->count();

            if ($referrerRewarded < $maxPerReferrer) {
                $this->creditBonus(
                    $referral->referrer_id,
                    $amount,
                    $referral->id,
                    'ErrandGuy referral reward — your friend completed their first errand!',
                );
                $referrerCredited = true;
            } else {
                \Illuminate\Support\Facades\Log::warning('Referral reward: referrer at cap, skipping referrer credit', [
                    'referrer_id' => $referral->referrer_id,
                    'referee_id' => $refereeId,
                    'cap' => $maxPerReferrer,
                ]);
            }

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
            // Referrer is only notified when they were actually credited
            // (they may have hit the per-referrer cap).
            if ($referrerCredited) {
                \App\Jobs\SendPushJob::dispatch(
                    $rewarded->referrer_id,
                    'Referral Reward!',
                    "You earned ₱{$amount} — your friend completed their first errand.",
                    ['type' => 'referral', 'referral_id' => $rewarded->id],
                );
            }
            \App\Jobs\SendPushJob::dispatch(
                $rewarded->referee_id,
                'Welcome Bonus!',
                "You earned ₱{$amount} for joining ErrandGuy through a referral.",
                ['type' => 'referral', 'referral_id' => $rewarded->id],
            );
        }

        return $rewarded;
    }

    /**
     * Has the referee made a genuine, settled, NON-CASH errand? Only such a
     * booking qualifies a referral for reward — a cash booking moves no money
     * through the platform and must not mint withdrawable-adjacent credit.
     */
    private function hasQualifyingBooking(string $refereeId): bool
    {
        return \App\Models\Payment::query()
            ->where('customer_id', $refereeId)
            ->where('status', 'completed')
            ->where('method', '!=', 'cash')
            ->whereHas('booking', fn ($q) => $q->where('status', 'completed'))
            ->exists();
    }

    /**
     * Credit a NON-WITHDRAWABLE promotional bonus (P0-6). Bonuses land in
     * `bonus_balance` — spendable on errands (drawn down before wallet cash)
     * but excluded from payout — so referral rewards can never be cashed out
     * as real money. `balance_after` records the bonus balance so the ledger
     * stays honest about which bucket moved. Assumes a surrounding DB
     * transaction (the row lock idiom mirrors handleCompletion).
     */
    private function creditBonus(string $userId, float $amount, string $referenceId, string $description): void
    {
        $user = User::lockForUpdate()->find($userId);
        if (!$user) {
            return;
        }

        $newBonus = (float) $user->bonus_balance + $amount;

        WalletTransaction::create([
            'user_id' => $user->id,
            'type' => 'bonus',
            'amount' => $amount,
            'balance_after' => $newBonus,
            'reference_id' => $referenceId,
            'description' => $description,
        ]);

        $user->update(['bonus_balance' => $newBonus]);
    }
}
