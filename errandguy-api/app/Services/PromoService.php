<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\PromoCode;
use Illuminate\Support\Facades\DB;

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
        ];
    }

    /**
     * Redeem a promo code by incrementing usage count.
     */
    public function redeem(string $promoCodeId, string $bookingId): void
    {
        DB::transaction(function () use ($promoCodeId, $bookingId) {
            PromoCode::where('id', $promoCodeId)->increment('used_count');

            Booking::where('id', $bookingId)->update([
                'promo_code_id' => $promoCodeId,
            ]);
        });
    }

    private function calculateDiscount(PromoCode $promo, float $amount): float
    {
        if ($promo->discount_type === 'percentage') {
            $discount = round($amount * ((float) $promo->discount_value / 100), 2);
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
