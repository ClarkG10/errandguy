<?php

namespace Tests\Feature\Booking;

use App\Models\ErrandType;
use App\Models\SystemConfig;
use App\Models\User;
use App\Services\PricingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * The app's "From ₱X" on the errand-type grid. It used to show the base fee,
 * which leaves out the service fee every booking pays, so no booking could
 * ever cost what the tile said. The catalog now carries `minimum_price`: what
 * PricingService itself charges on the cheapest vehicle the type offers, at
 * 0 km.
 */
class ErrandTypeMinimumPriceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
    }

    private function type(string $slug, array $overrides = []): ErrandType
    {
        return ErrandType::create(array_merge([
            'slug' => $slug, 'name' => ucfirst($slug), 'description' => $slug,
            'icon_name' => 'Package', 'base_fee' => 100.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'surcharge' => 0, 'is_active' => true, 'sort_order' => 1,
        ], $overrides));
    }

    /** @return array<string, array<string, mixed>> */
    private function catalog(): array
    {
        return collect($this->getJson('/api/v1/errand-types')->assertOk()->json('data'))
            ->keyBy('slug')
            ->all();
    }

    public function test_the_minimum_includes_the_service_fee(): void
    {
        $this->type('queue');

        // ₱100 base, walking (no premium), 0 km, plus the default 15% service fee.
        $this->assertEquals(115.0, $this->catalog()['queue']['minimum_price']);
    }

    public function test_it_is_exactly_what_pricing_charges_on_the_cheapest_vehicle(): void
    {
        $type = $this->type('delivery', ['base_fee' => 49.00, 'surcharge' => 5.00]);

        $walk = app(PricingService::class)->calculate($type->id, 14.6, 121.0, null, null, 'walk');

        $this->assertEquals($walk['total_amount'], $this->catalog()['delivery']['minimum_price']);
    }

    public function test_a_type_that_offers_no_walking_starts_at_its_cheapest_vehicle(): void
    {
        // A zero rate withdraws the vehicle for the type (PricingService).
        $this->type('custom', ['per_km_walk' => 0]);

        // Bicycle: ₱100 + ₱10 premium = ₱110, plus 15% = ₱126.50.
        $this->assertEquals(126.5, $this->catalog()['custom']['minimum_price']);
    }

    public function test_it_follows_the_staff_settings_for_the_fee_and_the_surcharge(): void
    {
        SystemConfig::setValue('platform_fee_percent', '10');
        $this->type('purchase', ['base_fee' => 80.00, 'surcharge' => 20.00]);

        // ₱80 + 10% (₱8) + ₱20 surcharge.
        $types = $this->catalog();
        $this->assertEquals(108.0, $types['purchase']['minimum_price']);
        // The shopping cap still rides along on the shopping type.
        $this->assertArrayHasKey('shopping_budget_max', $types['purchase']);
    }

    public function test_the_home_screen_catalog_carries_it_too(): void
    {
        $this->type('queue');
        $customer = User::factory()->create(['role' => 'customer']);

        $home = collect($this->actingAs($customer)->getJson('/api/v1/customer/home')->assertOk()->json('data.errand_types'))
            ->keyBy('slug');

        $this->assertEquals(115.0, $home['queue']['minimum_price']);
    }
}
