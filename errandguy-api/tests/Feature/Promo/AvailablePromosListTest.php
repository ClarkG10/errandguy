<?php

namespace Tests\Feature\Promo;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\PromoCode;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * GET /promos (the "available promos" list) must agree with PromoService::validate
 * on the per-user cap: a CANCELLED booking does not consume a redemption, so it
 * must not hide a promo the user can still redeem. (money-hunt 2026-08-17)
 */
class AvailablePromosListTest extends TestCase
{
    use RefreshDatabase;

    private function validPromo(): PromoCode
    {
        return PromoCode::create([
            'code' => 'SAVE10', 'discount_type' => 'percentage', 'discount_value' => 10,
            'min_order' => 0, 'usage_limit' => 100, 'per_user_limit' => 1,
            'valid_from' => now()->subDay(), 'valid_until' => now()->addWeek(), 'is_active' => true,
        ]);
    }

    private function bookingWithPromo(User $customer, PromoCode $promo, string $status): void
    {
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'd', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);
        Booking::create([
            'booking_number' => 'EG-'.strtoupper(uniqid()), 'customer_id' => $customer->id,
            'errand_type_id' => $type->id, 'status' => $status, 'promo_code_id' => $promo->id,
            'pickup_address' => 'a', 'pickup_lat' => 14.6, 'pickup_lng' => 120.98,
            'dropoff_address' => 'b', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15, 'surcharge' => 0,
            'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ]);
    }

    private function listedCodes(User $user): array
    {
        Sanctum::actingAs($user);

        return collect($this->getJson('/api/v1/promos')->assertOk()->json('data'))
            ->pluck('code')->all();
    }

    public function test_cancelled_promo_booking_does_not_hide_the_promo(): void
    {
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $promo = $this->validPromo();
        $this->bookingWithPromo($user, $promo, 'cancelled');

        // validate() would still let them redeem it, so the list must still show it.
        $this->assertContains($promo->code, $this->listedCodes($user));
    }

    public function test_completed_promo_booking_at_limit_hides_the_promo(): void
    {
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $promo = $this->validPromo();
        $this->bookingWithPromo($user, $promo, 'completed');

        // A real redemption consumes the per-user cap of 1 → hidden, matching validate().
        $this->assertNotContains($promo->code, $this->listedCodes($user));
    }
}
