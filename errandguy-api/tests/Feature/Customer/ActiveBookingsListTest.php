<?php

namespace Tests\Feature\Customer;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * `/bookings/active` (and the /customer/home aggregate that delegates to it)
 * used to expose exactly ONE in-flight booking. Nothing caps concurrent
 * bookings server-side and a days-out scheduled booking stays 'active' by
 * status, so a customer routinely has two or more — and every one but the
 * top of the ranking was invisible: no card, and no realtime status channel,
 * because the customer layout subscribes per rendered booking.
 *
 * The fix is purely ADDITIVE: an `active_bookings` list alongside the
 * untouched `data` / `active_booking` keys. This test pins both halves — the
 * singular key must keep meaning exactly what it meant (first of the ranking),
 * and the list must be the same ranking, same serialization, capped.
 */
class ActiveBookingsListTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $type;

    protected function setUp(): void
    {
        parent::setUp();

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'x', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeBooking(string $status, string $number, array $overrides = []): Booking
    {
        return Booking::create(array_merge([
            'booking_number' => $number,
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->type->id,
            'status' => $status,
            'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.9,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.5, 'dropoff_lng' => 121.0,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ], $overrides));
    }

    private function active(): array
    {
        return $this->actingAs($this->customer)
            ->getJson('/api/v1/bookings/active')
            ->assertOk()
            ->json();
    }

    public function test_it_lists_every_active_booking_not_just_the_newest(): void
    {
        $live = $this->makeBooking('in_transit', 'EG-A1');
        $second = $this->makeBooking('matched', 'EG-A2');

        $payload = $this->active();

        $this->assertCount(2, $payload['active_bookings']);
        $this->assertEqualsCanonicalizing(
            [$live->id, $second->id],
            array_column($payload['active_bookings'], 'id'),
        );
    }

    /**
     * The whole point of keeping the singular key: shipped clients read
     * `data` and must be unaffected. It has to stay the FIRST element of the
     * list, byte-identical (same eager loads, same conditional fields).
     */
    public function test_data_stays_the_first_element_of_the_list(): void
    {
        $this->makeBooking('in_transit', 'EG-B1');
        $this->makeBooking('matched', 'EG-B2');

        $payload = $this->active();

        $this->assertSame($payload['active_bookings'][0], $payload['data']);
    }

    public function test_a_future_scheduled_booking_never_outranks_a_live_one(): void
    {
        $live = $this->makeBooking('in_transit', 'EG-C1');
        // Created LAST (so newest by created_at) but scheduled for next week.
        $scheduled = $this->makeBooking('pending', 'EG-C2', [
            'schedule_type' => 'scheduled',
            'scheduled_at' => now()->addWeek(),
        ]);

        $payload = $this->active();

        $this->assertSame($live->id, $payload['data']['id']);
        $this->assertSame(
            [$live->id, $scheduled->id],
            array_column($payload['active_bookings'], 'id'),
        );
    }

    public function test_the_list_is_capped_at_three(): void
    {
        foreach (range(1, 5) as $i) {
            $this->makeBooking('matched', "EG-D{$i}");
        }

        $this->assertCount(3, $this->active()['active_bookings']);
    }

    public function test_it_is_an_empty_array_not_null_when_nothing_is_in_flight(): void
    {
        $this->makeBooking('completed', 'EG-E1');

        $payload = $this->active();

        $this->assertNull($payload['data']);
        $this->assertSame([], $payload['active_bookings']);
    }

    public function test_it_never_leaks_another_customers_active_booking(): void
    {
        $this->makeBooking('in_transit', 'EG-F1');

        $other = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $payload = $this->actingAs($other)->getJson('/api/v1/bookings/active')->assertOk()->json();

        $this->assertNull($payload['data']);
        $this->assertSame([], $payload['active_bookings']);
    }

    // ── the aggregate must carry the same list, identically ─────────────

    public function test_the_home_aggregate_mirrors_the_endpoint_exactly(): void
    {
        $this->makeBooking('in_transit', 'EG-G1');
        $this->makeBooking('matched', 'EG-G2');

        $endpoint = $this->active();

        $home = $this->actingAs($this->customer)
            ->getJson('/api/v1/customer/home')
            ->assertOk()
            ->json('data');

        $this->assertSame($endpoint['active_bookings'], $home['active_bookings']);
        $this->assertSame($endpoint['data'], $home['active_booking']);
        $this->assertSame($home['active_bookings'][0], $home['active_booking']);
    }

    public function test_the_home_aggregate_keeps_the_list_an_array_when_empty(): void
    {
        $home = $this->actingAs($this->customer)
            ->getJson('/api/v1/customer/home')
            ->assertOk()
            ->json('data');

        $this->assertNull($home['active_booking']);
        $this->assertSame([], $home['active_bookings']);
    }
}
