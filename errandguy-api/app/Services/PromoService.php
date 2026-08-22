<?php

namespace App\Services;

use App\Exceptions\PromoUserLimitReachedException;
use App\Models\Booking;
use App\Models\PromoCode;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class PromoService
{
    /**
     * Validate a promo code for a given user and booking amount.
     * Returns promo details with calculated discount or throws.
     */
    public function validate(string $code, string $userId, float $bookingAmount): array
    {
        $promo = PromoCode::where('code', strtoupper(trim($code)))
            ->where('is_active', true)
            ->first();

        if (!$promo) {
            throw new \InvalidArgumentException('Invalid or expired promo code.');
        }

        // Check validity period
        if ($promo->valid_from && now()->lt($promo->valid_from)) {
            throw new \InvalidArgumentException('This promo code is not yet active.');
        }

        if ($promo->valid_until && now()->gt($promo->valid_until)) {
            throw new \InvalidArgumentException('This promo code has expired.');
        }

        // Check global usage limit
        if ($promo->usage_limit !== null && $promo->used_count >= $promo->usage_limit) {
            throw new \InvalidArgumentException('This promo code has reached its usage limit.');
        }

        // Check per-user limit
        if ($promo->per_user_limit !== null) {
            $userUsageCount = Booking::where('customer_id', $userId)
                ->where('promo_code_id', $promo->id)
                ->whereNotIn('status', ['cancelled'])
                ->count();

            if ($userUsageCount >= $promo->per_user_limit) {
                throw new \InvalidArgumentException('You have already used this promo code the maximum number of times.');
            }
        }

        // Check minimum order
        if ($promo->min_order && $bookingAmount < (float) $promo->min_order) {
            throw new \InvalidArgumentException("Minimum order of ₱{$promo->min_order} required for this promo.");
        }

        // Calculate discount
        $discount = $this->calculateDiscount($promo, $bookingAmount);

        return [
            'id' => $promo->id,
            'code' => $promo->code,
            'description' => $promo->description,
            'discount_type' => $promo->discount_type,
            'discount_value' => (float) $promo->discount_value,
            'max_discount' => (float) $promo->max_discount,
            'discount' => $discount,
            'per_user_limit' => $promo->per_user_limit,
        ];
    }

    /**
     * Race-safe per-user limit enforcement. validate() checks the per-user cap
     * with a plain COUNT (a check-then-create TOCTOU: two concurrent bookings by
     * one user both read count < limit and both take the discount). This
     * serializes concurrent redemptions of THE SAME promo by THE SAME user on a
     * per-(user,promo) anchor row, then re-counts under that lock and throws if
     * the user is already at their limit.
     *
     * MUST be called INSIDE the transaction that also creates the booking, so the
     * FOR UPDATE lock is held until the booking is committed — that is what makes
     * a second, concurrent caller wait, then re-count and SEE the first booking.
     * The anchor carries no counter; the cap stays "non-cancelled bookings with
     * this promo", which self-corrects on cancellation (no drift to maintain).
     */
    public function assertUserSlotAvailable(string $promoCodeId, string $userId, int $perUserLimit): void
    {
        // Materialise the anchor row (idempotent, race-safe via the unique index).
        DB::table('promo_user_redemptions')->insertOrIgnore([
            'id' => (string) Str::uuid(),
            'user_id' => $userId,
            'promo_code_id' => $promoCodeId,
            'created_at' => now(),
        ]);

        // Serialize on it: a concurrent caller for the same (user, promo) blocks
        // here until we commit.
        DB::table('promo_user_redemptions')
            ->where('user_id', $userId)
            ->where('promo_code_id', $promoCodeId)
            ->lockForUpdate()
            ->first();

        // INVARIANT (correctness depends on it): this COUNT must be the FIRST
        // consistent read in the enclosing transaction. InnoDB (REPEATABLE READ)
        // pins the snapshot at the first consistent read; the insertOrIgnore
        // (write) and the FOR UPDATE (locking/current read) above do NOT pin it,
        // so this COUNT runs only AFTER the FOR UPDATE unblocks (i.e. after a
        // competing booking committed) and therefore SEES it. Do NOT add a plain
        // SELECT earlier in this method OR in the caller's transaction before
        // this point, or the snapshot pins early and the per-user race reopens.
        $used = Booking::where('customer_id', $userId)
            ->where('promo_code_id', $promoCodeId)
            ->whereNotIn('status', ['cancelled'])
            ->count();

        if ($used >= $perUserLimit) {
            throw new PromoUserLimitReachedException();
        }
    }

    /**
     * Redeem a promo code by incrementing its usage count — atomically and
     * limit-guarded (payment review P0-7).
     *
     * validate() and redeem() are separate steps, so two concurrent bookings
     * could both pass an unlocked used_count check and then both increment,
     * pushing used_count past usage_limit (TOCTOU). The increment here is a
     * single conditional UPDATE (…WHERE used_count < usage_limit) so the count
     * can NEVER exceed the limit regardless of concurrency. If the code hit its
     * limit between validate and redeem, the increment is skipped (0 rows) and
     * logged — the already-quoted discount stands (a rare, bounded over-grant),
     * but the counter is never corrupted.
     */
    public function redeem(string $promoCodeId, string $bookingId): void
    {
        DB::transaction(function () use ($promoCodeId, $bookingId) {
            $affected = PromoCode::where('id', $promoCodeId)
                ->where(function ($q) {
                    $q->whereNull('usage_limit')
                        ->orWhereColumn('used_count', '<', 'usage_limit');
                })
                ->increment('used_count');

            if ($affected === 0) {
                Log::warning('Promo redeem skipped: usage limit reached at redeem time', [
                    'promo_code_id' => $promoCodeId,
                    'booking_id' => $bookingId,
                ]);
            }

            // promo_code_id = "a promo was applied" (discount + audit).
            // promo_redeemed = "this booking actually consumed a global slot"
            // and therefore OWES a decrement on reversal. It is only true when
            // the conditional increment above fired, so a booking whose redeem
            // was skipped can never later drive used_count below the true count.
            Booking::where('id', $bookingId)->update([
                'promo_code_id' => $promoCodeId,
                'promo_redeemed' => $affected === 1,
            ]);
        });
    }

    /**
     * Reverse a booking's promo redemption when the booking will never become a
     * completed, kept errand — create-time payment failure, abandoned/expired
     * online invoice, or any post-creation cancel (customer / no-runner /
     * negotiate-expiry / admin). Without this a redeem that happens BEFORE
     * settlement leaks used_count on every non-completing booking (P0-7).
     *
     * Consumption-verified + idempotent: it decrements ONLY when this specific
     * booking is flagged promo_redeemed (so a skipped-increment booking can't
     * under-count a slot a different live booking holds), and the check-and-
     * clear under a row lock means calling it from multiple terminal paths — or
     * a replayed webhook — reverses exactly once. A completed booking is left
     * untouched: it legitimately kept its redemption.
     */
    public function unredeem(string $bookingId): void
    {
        DB::transaction(function () use ($bookingId) {
            $booking = Booking::whereKey($bookingId)->lockForUpdate()->first();

            if (! $booking
                || ! $booking->promo_redeemed
                || ! $booking->promo_code_id
                || $booking->status === 'completed') {
                return;
            }

            // Claim the reversal (idempotent under the lock), then decrement.
            $booking->update(['promo_redeemed' => false]);

            PromoCode::where('id', $booking->promo_code_id)
                ->where('used_count', '>', 0)
                ->decrement('used_count');
        });
    }

    private function calculateDiscount(PromoCode $promo, float $amount): float
    {
        if ($promo->discount_type === 'percentage') {
            // Clamp the percentage to 0..100 as a defense-in-depth backstop to
            // the admin form's cap: a stored discount_value > 100 (a legacy row
            // or a value entered before the form was bounded) must never be
            // treated as more than a full discount.
            $pct = max(0.0, min(100.0, (float) $promo->discount_value));
            $discount = round($amount * ($pct / 100), 2);
        } else {
            $discount = (float) $promo->discount_value;
        }

        // Enforce max discount cap
        if ($promo->max_discount && $discount > (float) $promo->max_discount) {
            $discount = (float) $promo->max_discount;
        }

        return min($discount, $amount);
    }
}
