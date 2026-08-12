<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\PromoCode;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Tests\TestCase;

/**
 * Per-user promo limit. The enforcement runs under a per-(user,promo) lock at
 * booking create (PromoService::assertUserSlotAvailable) so two concurrent
 * bookings can't both pass the check-then-create limit test; the true race is
 * proven by the lock arch-guard + a local two-connection script. These
 * sequential tests lock in the policy + guard against regression: the cap is
 * "non-cancelled bookings with this promo", so cancelling frees a slot.
 */
class PromoPerUserLimitTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $type;
    private array $data;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'd', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'surcharge' => 0, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);
        $this->data = [
            'errand_type_id' => $this->type->id,
            'pickup_address' => '123 Main', 'pickup_lat' => 14.5995, 'pickup_lng' => 120.9842,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.5547, 'dropoff_lng' => 121.0244,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'payment_method' => 'cash',
        ];
    }

    private function promo(int $perUserLimit): void
    {
        PromoCode::create([
            'code' => 'SAVE10', 'description' => 'x', 'discount_type' => 'percentage', 'discount_value' => 10,
            'max_discount' => null, 'min_order' => 0, 'usage_limit' => 1000, 'per_user_limit' => $perUserLimit,
            'used_count' => 0, 'valid_from' => now()->subDay(), 'valid_until' => now()->addWeek(), 'is_active' => true,
        ]);
    }

    private function book()
    {
        return $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', array_merge($this->data, ['promo_code' => 'SAVE10']));
    }

    public function test_first_booking_applies_the_promo_and_the_second_is_rejected(): void
    {
        Bus::fake();
        $this->promo(1);

        $this->book()->assertStatus(201);
        $first = Booking::where('customer_id', $this->customer->id)->firstOrFail();
        $this->assertNotNull($first->promo_code_id);
        $this->assertGreaterThan(0, (float) $first->promo_discount);

        // The per-user cap (1) is reached → a 2nd booking with the promo is 422.
        $this->book()->assertStatus(422);
        $this->assertSame(
            1,
            Booking::where('customer_id', $this->customer->id)->whereNotNull('promo_code_id')->count(),
        );
    }

    public function test_cancelling_a_promo_booking_frees_the_users_slot(): void
    {
        Bus::fake();
        $this->promo(1);

        $this->book()->assertStatus(201);
        Booking::where('customer_id', $this->customer->id)->firstOrFail()->update(['status' => 'cancelled']);

        // A cancelled booking no longer counts against the cap → the promo works again.
        $this->book()->assertStatus(201);
        $this->assertSame(2, Booking::where('customer_id', $this->customer->id)->count());
    }

    public function test_a_two_per_user_promo_allows_two_then_rejects_the_third(): void
    {
        Bus::fake();
        $this->promo(2);

        $this->book()->assertStatus(201);
        $this->book()->assertStatus(201);
        $this->book()->assertStatus(422);
    }
}
