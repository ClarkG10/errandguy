<?php

namespace Tests\Unit;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\PromoCode;
use App\Models\User;
use App\Services\PromoService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Locks the promo discount math + validation limits (audit-gap: the promo path
 * directly reduces what the customer is charged, and had zero coverage).
 */
class PromoServiceTest extends TestCase
{
    use RefreshDatabase;

    private PromoService $service;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(PromoService::class);
        $this->user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
    }

    private function promo(array $overrides = []): PromoCode
    {
        return PromoCode::factory()->create(array_merge([
            'discount_type' => 'percentage', 'discount_value' => 10, 'max_discount' => null,
            'min_order' => 0, 'usage_limit' => 100, 'per_user_limit' => 100,
            'valid_from' => now()->subDay(), 'valid_until' => now()->addWeek(), 'is_active' => true,
        ], $overrides));
    }

    private function discount(PromoCode $promo, float $amount): float
    {
        return $this->service->validate($promo->code, $this->user->id, $amount)['discount'];
    }

    public function test_percentage_discount(): void
    {
        $this->assertSame(20.0, $this->discount($this->promo(['discount_value' => 10]), 200));
    }

    public function test_max_discount_caps_a_percentage(): void
    {
        // 50% of 400 = 200, capped to 100.
        $this->assertSame(100.0, $this->discount($this->promo(['discount_value' => 50, 'max_discount' => 100]), 400));
    }

    public function test_fixed_discount(): void
    {
        $this->assertSame(30.0, $this->discount($this->promo(['discount_type' => 'fixed', 'discount_value' => 30]), 200));
    }

    public function test_discount_never_exceeds_the_order_amount(): void
    {
        // Fixed ₱500 off a ₱200 order clamps to ₱200 (total can't go negative).
        $this->assertSame(200.0, $this->discount($this->promo(['discount_type' => 'fixed', 'discount_value' => 500]), 200));
    }

    public function test_below_minimum_order_is_rejected(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->service->validate($this->promo(['min_order' => 300])->code, $this->user->id, 200);
    }

    public function test_expired_code_is_rejected(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->service->validate($this->promo(['valid_until' => now()->subDay()])->code, $this->user->id, 200);
    }

    public function test_not_yet_active_code_is_rejected(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->service->validate($this->promo(['valid_from' => now()->addDay()])->code, $this->user->id, 200);
    }

    public function test_inactive_code_is_rejected(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->service->validate($this->promo(['is_active' => false])->code, $this->user->id, 200);
    }

    public function test_global_usage_limit_exhausted_is_rejected(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->service->validate($this->promo(['usage_limit' => 5, 'used_count' => 5])->code, $this->user->id, 200);
    }

    public function test_per_user_limit_is_enforced(): void
    {
        $promo = $this->promo(['per_user_limit' => 1]);
        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'x',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);
        // An existing (non-cancelled) booking already used this promo for the user.
        Booking::create([
            'booking_number' => 'EG-20260331-PROMO', 'customer_id' => $this->user->id,
            'errand_type_id' => $errandType->id, 'status' => 'completed', 'promo_code_id' => $promo->id,
            'pickup_address' => '1', 'pickup_lat' => 14.6, 'pickup_lng' => 121, 'dropoff_address' => '2',
            'dropoff_lat' => 14.5, 'dropoff_lng' => 121, 'schedule_type' => 'now', 'pricing_mode' => 'fixed',
            'vehicle_type_rate' => 'motorcycle', 'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50,
            'service_fee' => 15, 'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ]);

        $this->expectException(\InvalidArgumentException::class);
        $this->service->validate($promo->code, $this->user->id, 200);
    }
}
