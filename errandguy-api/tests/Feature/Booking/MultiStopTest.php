<?php

namespace Tests\Feature\Booking;

use App\Jobs\BroadcastToRunnersJob;
use App\Jobs\MatchRunnerJob;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\SystemConfig;
use App\Models\User;
use App\Services\PricingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Tests\TestCase;

/**
 * Multi-stop errands: a booking may add extra destinations after the primary
 * dropoff. They add straight-line legs to the fare + a flat per-stop fee, and
 * persist as ordered booking_stops rows.
 */
class MultiStopTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        SystemConfig::updateOrCreate(['key' => 'multi_stop_fee'], ['value' => '15']);
        SystemConfig::updateOrCreate(['key' => 'platform_fee_percent'], ['value' => '15']);

        $this->customer = User::factory()->create([
            'role' => 'customer', 'status' => 'active', 'wallet_balance' => 0,
        ]);
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'surcharge' => 0.00, 'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    // ── Pricing ──────────────────────────────────────────────────────────────

    public function test_extra_stops_add_their_legs_to_the_route_distance(): void
    {
        $pricing = app(PricingService::class);
        // A → B → C, roughly collinear so the multi-leg total clearly exceeds
        // the direct A → B leg.
        $single = $pricing->calculate($this->errandType->id, 14.60, 120.98, 14.55, 121.02, 'motorcycle');
        $multi = $pricing->calculate(
            $this->errandType->id, 14.60, 120.98, 14.55, 121.02, 'motorcycle',
            extraStops: [['lat' => 14.50, 'lng' => 121.06]],
        );

        $this->assertGreaterThan($single['distance_km'], $multi['distance_km']);
        $this->assertSame(1, $multi['stops_count']);
    }

    public function test_each_extra_stop_adds_the_flat_per_stop_fee_to_surcharge_and_payout(): void
    {
        $pricing = app(PricingService::class);
        $base = $pricing->calculate($this->errandType->id, 14.60, 120.98, 14.60, 120.98, 'motorcycle');
        // Same coords for the stop so distance is unchanged — isolates the fee.
        $withStop = $pricing->calculate(
            $this->errandType->id, 14.60, 120.98, 14.60, 120.98, 'motorcycle',
            extraStops: [['lat' => 14.60, 'lng' => 120.98]],
        );

        $this->assertSame(15.0, (float) $withStop['stops_fee']);
        // Surcharge rose by exactly the per-stop fee.
        $this->assertEqualsWithDelta((float) $base['surcharge'] + 15.0, (float) $withStop['surcharge'], 0.001);
        // The customer pays it and the runner receives it (payout = total − fee).
        $this->assertEqualsWithDelta((float) $base['total_amount'] + 15.0, (float) $withStop['total_amount'], 0.001);
        $this->assertGreaterThan((float) $base['runner_payout'], (float) $withStop['runner_payout']);
    }

    public function test_a_booking_with_no_stops_prices_exactly_as_before(): void
    {
        $pricing = app(PricingService::class);
        $before = $pricing->calculate($this->errandType->id, 14.60, 120.98, 14.55, 121.02, 'motorcycle');
        $withEmpty = $pricing->calculate(
            $this->errandType->id, 14.60, 120.98, 14.55, 121.02, 'motorcycle', extraStops: []
        );

        $this->assertSame($before['total_amount'], $withEmpty['total_amount']);
        $this->assertSame(0, $withEmpty['stops_count']);
        $this->assertSame(0.0, (float) $withEmpty['stops_fee']);
    }

    // ── Booking create ─────────────────────────────────────────────────────

    public function test_creating_a_booking_with_stops_persists_them_in_order_and_prices_them(): void
    {
        // Fake ALL jobs (matches CreateBookingTest): a successful create
        // dispatches matching + auto-cancel jobs we don't want running here.
        Bus::fake();

        $payload = [
            'errand_type_id' => $this->errandType->id,
            'pickup_address' => 'Pickup', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'Drop 1', 'dropoff_lat' => 14.58, 'dropoff_lng' => 121.00,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'payment_method' => 'cash',
            'stops' => [
                ['address' => 'Drop 2', 'lat' => 14.55, 'lng' => 121.03, 'note' => 'Leave at gate'],
                ['address' => 'Drop 3', 'lat' => 14.52, 'lng' => 121.06, 'contact_name' => 'Ana'],
            ],
        ];

        $res = $this->actingAs($this->customer)->postJson('/api/v1/bookings', $payload);
        $res->assertCreated();

        $booking = Booking::first();
        $this->assertSame(2, $booking->stops()->count());
        $stops = $booking->stops()->get();
        $this->assertSame([1, 2], $stops->pluck('sequence')->all());
        $this->assertSame('Drop 2', $stops[0]->address);
        $this->assertSame('Leave at gate', $stops[0]->note);
        $this->assertSame('Ana', $stops[1]->contact_name);
        // Two extra stops → ₱30 of per-stop fee in the surcharge.
        $this->assertSame(2, (int) $booking->stops()->count());
        $this->assertGreaterThanOrEqual(30.0, (float) $booking->surcharge);

        // Exposed on the detail resource.
        $show = $this->actingAs($this->customer)->getJson("/api/v1/bookings/{$booking->id}");
        $show->assertOk()->assertJsonCount(2, 'data.stops');
        $show->assertJsonPath('data.stops.0.address', 'Drop 2');
    }

    public function test_estimate_accounts_for_stops(): void
    {
        $withoutStops = $this->actingAs($this->customer)->postJson('/api/v1/bookings/estimate', [
            'errand_type_id' => $this->errandType->id,
            'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_lat' => 14.58, 'dropoff_lng' => 121.00,
        ])->assertOk()->json('data.distance_km');

        $withStops = $this->actingAs($this->customer)->postJson('/api/v1/bookings/estimate', [
            'errand_type_id' => $this->errandType->id,
            'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_lat' => 14.58, 'dropoff_lng' => 121.00,
            'stops' => [['lat' => 14.52, 'lng' => 121.06]],
        ])->assertOk();

        $withStops->assertJsonPath('data.stops_count', 1);
        $this->assertGreaterThan($withoutStops, $withStops->json('data.distance_km'));
    }

    // ── Validation ───────────────────────────────────────────────────────────

    public function test_more_than_three_extra_stops_is_rejected(): void
    {
        Bus::fake();
        $stops = [];
        for ($i = 0; $i < 4; $i++) {
            $stops[] = ['address' => "Drop {$i}", 'lat' => 14.5 + $i * 0.01, 'lng' => 121.0];
        }

        $this->actingAs($this->customer)->postJson('/api/v1/bookings', [
            'errand_type_id' => $this->errandType->id,
            'pickup_address' => 'Pickup', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'Drop', 'dropoff_lat' => 14.58, 'dropoff_lng' => 121.00,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'payment_method' => 'cash', 'stops' => $stops,
        ])->assertStatus(422)->assertJsonValidationErrors(['stops']);
    }

    public function test_a_stop_without_coordinates_is_rejected(): void
    {
        Bus::fake();
        $this->actingAs($this->customer)->postJson('/api/v1/bookings', [
            'errand_type_id' => $this->errandType->id,
            'pickup_address' => 'Pickup', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'Drop', 'dropoff_lat' => 14.58, 'dropoff_lng' => 121.00,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'payment_method' => 'cash',
            'stops' => [['address' => 'No coords']],
        ])->assertStatus(422)->assertJsonValidationErrors(['stops.0.lat', 'stops.0.lng']);
    }

    public function test_single_location_errand_rejects_stops(): void
    {
        Bus::fake();
        $queue = ErrandType::create([
            'slug' => 'queue', 'name' => 'Queue', 'description' => 'Line up',
            'icon_name' => 'Users', 'base_fee' => 40.00, 'per_km_walk' => 10.00,
            'per_km_bicycle' => 10.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 10.00,
            'surcharge' => 0.00, 'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 2,
        ]);

        $this->actingAs($this->customer)->postJson('/api/v1/bookings', [
            'errand_type_id' => $queue->id,
            'pickup_address' => 'Pickup', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'payment_method' => 'cash',
            'stops' => [['address' => 'Drop 2', 'lat' => 14.55, 'lng' => 121.03]],
        ])->assertStatus(422)->assertJsonValidationErrors(['stops']);
    }
}
