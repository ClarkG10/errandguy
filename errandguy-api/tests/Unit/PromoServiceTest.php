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

    private function makeBooking(?string $promoCodeId = null): Booking
    {
        $errandType = ErrandType::firstOrCreate(
            ['slug' => 'delivery'],
            ['name' => 'Delivery', 'description' => 'x', 'icon_name' => 'Package',
                'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
                'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30,
                'is_active' => true, 'sort_order' => 1],
        );

        return Booking::create([
            'booking_number' => 'EG-'.substr((string) \Illuminate\Support\Str::uuid(), 0, 8),
            'customer_id' => $this->user->id, 'errand_type_id' => $errandType->id, 'status' => 'pending',
            'pickup_address' => '1', 'pickup_lat' => 14.6, 'pickup_lng' => 121, 'dropoff_address' => '2',
            'dropoff_lat' => 14.5, 'dropoff_lng' => 121, 'schedule_type' => 'now', 'pricing_mode' => 'fixed',
            'vehicle_type_rate' => 'motorcycle', 'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50,
            'service_fee' => 15, 'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false, 'promo_code_id' => $promoCodeId,
        ]);
    }

    public function test_redeem_never_pushes_used_count_past_the_global_limit(): void
    {
        // TOCTOU guard: even if two bookings both passed validate() at the limit
        // boundary, redeem's conditional increment can't exceed usage_limit.
        $promo = $this->promo(['usage_limit' => 1, 'used_count' => 0]);
        $a = $this->makeBooking();
        $b = $this->makeBooking();

        $this->service->redeem($promo->id, $a->id);
        $this->service->redeem($promo->id, $b->id);

        $this->assertEquals(1, $promo->fresh()->used_count);
        // Only the booking that actually incremented is flagged as consuming.
        $this->assertTrue($a->fresh()->promo_redeemed);
        $this->assertFalse($b->fresh()->promo_redeemed);
    }

    public function test_reversal_is_consumption_verified_so_a_skipped_redeem_cannot_undercount(): void
    {
        // The HIGH regression the review caught: B's redeem was SKIPPED (limit
        // hit), so reversing B must NOT decrement a slot that A genuinely holds.
        $promo = $this->promo(['usage_limit' => 1, 'used_count' => 0]);
        $a = $this->makeBooking();
        $b = $this->makeBooking();
        $this->service->redeem($promo->id, $a->id); // 0 -> 1, A flagged
        $this->service->redeem($promo->id, $b->id); // skipped, B NOT flagged

        // Reversing the skipped booking is a no-op (it consumed nothing).
        $this->service->unredeem($b->id);
        $this->assertEquals(1, $promo->fresh()->used_count, 'skipped booking must not under-count');

        // Reversing the real consumer releases exactly its slot.
        $this->service->unredeem($a->id);
        $this->assertEquals(0, $promo->fresh()->used_count);
    }

    public function test_unredeem_is_idempotent_and_skips_completed_bookings(): void
    {
        $promo = $this->promo(['usage_limit' => 5, 'used_count' => 0]);
        $booking = $this->makeBooking();
        $this->service->redeem($promo->id, $booking->id); // used_count 0 -> 1

        $this->service->unredeem($booking->id);
        $this->assertEquals(0, $promo->fresh()->used_count);
        // A replayed reversal (webhook + reconcile + cancel all firing) is a no-op.
        $this->service->unredeem($booking->id);
        $this->assertEquals(0, $promo->fresh()->used_count);

        // A completed errand keeps its redemption forever.
        $promo2 = $this->promo(['usage_limit' => 5, 'used_count' => 0]);
        $done = $this->makeBooking();
        $this->service->redeem($promo2->id, $done->id);
        $done->update(['status' => 'completed']);
        $this->service->unredeem($done->id);
        $this->assertEquals(1, $promo2->fresh()->used_count, 'completed booking must keep its use');
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
