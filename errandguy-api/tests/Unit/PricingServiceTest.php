<?php

namespace Tests\Unit;

use App\Models\ErrandType;
use App\Services\PricingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PricingServiceTest extends TestCase
{
    use RefreshDatabase;

    private PricingService $service;
    private ErrandType $deliveryType;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        $this->service = app(PricingService::class);

        $this->deliveryType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'surcharge' => 0.00, 'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    public function test_calculate_returns_required_keys(): void
    {
        $result = $this->service->calculate(
            $this->deliveryType->id, 14.5995, 120.9842, 14.5547, 121.0244, 'motorcycle'
        );

        $this->assertArrayHasKey('base_fee', $result);
        $this->assertArrayHasKey('distance_km', $result);
        $this->assertArrayHasKey('distance_fee', $result);
        $this->assertArrayHasKey('service_fee', $result);
        $this->assertArrayHasKey('surcharge', $result);
        $this->assertArrayHasKey('total_amount', $result);
        $this->assertArrayHasKey('runner_payout', $result);
        $this->assertArrayHasKey('vehicle_type', $result);
    }

    public function test_apply_negotiate_offer_charges_offer_and_keeps_flat_fee(): void
    {
        $fixed = $this->service->calculate(
            $this->deliveryType->id, 14.5995, 120.9842, 14.5547, 121.0244, 'motorcycle'
        );

        $negotiated = $this->service->applyNegotiateOffer($fixed, 250.00);

        // The offer is exactly what the customer pays.
        $this->assertEquals(250.00, $negotiated['total_amount']);
        // Platform keeps the SAME flat computed service fee (not a % of the offer).
        $this->assertEquals($fixed['service_fee'], $negotiated['service_fee']);
        // Runner receives the offer minus that flat fee.
        $this->assertEquals(round(250.00 - $fixed['service_fee'], 2), $negotiated['runner_payout']);
    }

    public function test_apply_negotiate_offer_never_makes_payout_negative(): void
    {
        $fixed = $this->service->calculate(
            $this->deliveryType->id, 14.5995, 120.9842, 14.5547, 121.0244, 'motorcycle'
        );

        // An offer below the flat service fee clamps the runner payout at 0
        // rather than going negative.
        $negotiated = $this->service->applyNegotiateOffer($fixed, 0.01);
        $this->assertEquals(0.0, $negotiated['runner_payout']);
    }

    public function test_base_fee_matches_errand_type(): void
    {
        $result = $this->service->calculate(
            $this->deliveryType->id, 14.5995, 120.9842, 14.5547, 121.0244, 'motorcycle'
        );

        $this->assertEquals(50.00, $result['base_fee']);
    }

    public function test_distance_km_is_positive(): void
    {
        $result = $this->service->calculate(
            $this->deliveryType->id, 14.5995, 120.9842, 14.5547, 121.0244, 'motorcycle'
        );

        $this->assertGreaterThan(0, $result['distance_km']);
    }

    public function test_different_vehicle_types_produce_different_fees(): void
    {
        $walk = $this->service->calculate(
            $this->deliveryType->id, 14.5995, 120.9842, 14.5547, 121.0244, 'walk'
        );
        $car = $this->service->calculate(
            $this->deliveryType->id, 14.5995, 120.9842, 14.5547, 121.0244, 'car'
        );

        // walk per_km=15, car per_km=18, so car should be more expensive
        $this->assertGreaterThan($walk['distance_fee'], $car['distance_fee']);
    }

    public function test_total_amount_equals_sum_of_components(): void
    {
        $result = $this->service->calculate(
            $this->deliveryType->id, 14.5995, 120.9842, 14.5547, 121.0244, 'motorcycle'
        );

        // total = base + vehicle premium + distance + service fee + surcharge.
        // (The per-vehicle base premium was added so vehicle choice changes the
        // quote even at ~0 distance; see PricingService::VEHICLE_BASE_PREMIUM.)
        $expectedTotal = $result['base_fee'] + $result['vehicle_premium']
            + $result['distance_fee'] + $result['service_fee'] + $result['surcharge'];
        $this->assertEquals(round($expectedTotal, 2), $result['total_amount']);
    }

    public function test_runner_payout_is_non_negative(): void
    {
        $result = $this->service->calculate(
            $this->deliveryType->id, 14.5995, 120.9842, 14.5547, 121.0244, 'motorcycle'
        );

        $this->assertGreaterThanOrEqual(0, $result['runner_payout']);
    }

    public function test_estimate_returns_all_vehicle_types(): void
    {
        $result = $this->service->estimate(
            $this->deliveryType->id, 14.5995, 120.9842, 14.5547, 121.0244
        );

        $this->assertArrayHasKey('walk', $result);
        $this->assertArrayHasKey('bicycle', $result);
        $this->assertArrayHasKey('motorcycle', $result);
        $this->assertArrayHasKey('car', $result);

        // estimate() also returns top-level scalar/array metadata
        // (distance_km, min_negotiate_fee, recommended_min/max, vehicle_types)
        // alongside the per-vehicle breakdowns — only assert on the vehicles.
        foreach (['walk', 'bicycle', 'motorcycle', 'car'] as $type) {
            $this->assertArrayHasKey('total_amount', $result[$type]);
            $this->assertGreaterThan(0, $result[$type]['total_amount']);
        }
    }

    public function test_zero_distance_booking(): void
    {
        $result = $this->service->calculate(
            $this->deliveryType->id, 14.5995, 120.9842, 14.5995, 120.9842, 'motorcycle'
        );

        $this->assertEquals(0, $result['distance_km']);
        $this->assertEquals(0, $result['distance_fee']);
        // Total should still include base fee and service fee
        $this->assertGreaterThan(0, $result['total_amount']);
    }

    public function test_service_fee_is_15_percent_of_subtotal(): void
    {
        $result = $this->service->calculate(
            $this->deliveryType->id, 14.5995, 120.9842, 14.5547, 121.0244, 'motorcycle'
        );

        // The 15% platform fee is charged on the full gross subtotal, which
        // includes the per-vehicle base premium.
        $subtotal = $result['base_fee'] + $result['vehicle_premium'] + $result['distance_fee'];
        $expectedServiceFee = round($subtotal * 0.15, 2);
        $this->assertEquals($expectedServiceFee, $result['service_fee']);
    }

    public function test_estimate_does_not_crash_for_a_walk_only_zero_base_config(): void
    {
        // A single-location, walk-only errand with a zero base/surcharge yields a
        // total of exactly 0.0 for its only vehicle. array_filter drops that 0.0,
        // so pre-fix min([]) threw a ValueError (500) on the estimate endpoint.
        // It must instead fall back to the negotiate floor.
        $walkOnly = ErrandType::create([
            'slug' => 'queue', 'name' => 'Queue', 'description' => 'Wait in line',
            'icon_name' => 'Clock', 'base_fee' => 0.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 0.00, 'per_km_motorcycle' => 0.00, 'per_km_car' => 0.00,
            'surcharge' => 0.00, 'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 2,
        ]);

        // No dropoff => distance 0 => walk total 0.0. This must not throw.
        $estimates = $this->service->estimate($walkOnly->id, 14.5995, 120.9842, null, null);

        $this->assertSame(['walk'], $estimates['vehicle_types']);
        $this->assertEquals(0.0, $estimates['walk']['total_amount']);
        $this->assertEquals(30.0, $estimates['recommended_min']);
    }
}
