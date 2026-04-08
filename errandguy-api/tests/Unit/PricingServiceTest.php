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

        $expectedTotal = $result['base_fee'] + $result['distance_fee'] + $result['service_fee'] + $result['surcharge'];
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

        foreach ($result as $type => $pricing) {
            $this->assertArrayHasKey('total_amount', $pricing);
            $this->assertGreaterThan(0, $pricing['total_amount']);
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

        $subtotal = $result['base_fee'] + $result['distance_fee'];
        $expectedServiceFee = round($subtotal * 0.15, 2);
        $this->assertEquals($expectedServiceFee, $result['service_fee']);
    }
}
