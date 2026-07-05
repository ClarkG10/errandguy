<?php

namespace Tests\Feature\Payment;

use App\Models\ErrandType;
use App\Models\User;
use App\Services\PaymentMethodCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Tests\TestCase;

class PaymentAvailabilityTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $type;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 5000]);
        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'x', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    public function test_available_methods_returns_full_set_by_default(): void
    {
        $res = $this->actingAs($this->customer)->getJson('/api/v1/payments/available-methods');
        $res->assertOk();
        $this->assertCount(5, $res->json('data'));
    }

    public function test_available_methods_reflects_operator_selection(): void
    {
        PaymentMethodCatalog::setEnabled(['wallet', 'cash']);

        $res = $this->actingAs($this->customer)->getJson('/api/v1/payments/available-methods');
        $res->assertOk();
        $types = collect($res->json('data'))->pluck('type')->all();
        $this->assertEqualsCanonicalizing(['wallet', 'cash'], $types);
    }

    public function test_booking_with_disabled_method_is_rejected(): void
    {
        Bus::fake();
        PaymentMethodCatalog::setEnabled(['wallet', 'cash']); // gcash disabled

        $res = $this->actingAs($this->customer)->postJson('/api/v1/bookings', [
            'errand_type_id' => $this->type->id,
            'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.9,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.5, 'dropoff_lng' => 121.0,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'payment_method' => 'gcash',
        ]);

        $res->assertStatus(422)->assertJsonValidationErrors(['payment_method']);
    }

    public function test_booking_with_enabled_method_succeeds(): void
    {
        Bus::fake();
        PaymentMethodCatalog::setEnabled(['wallet', 'cash']);

        $res = $this->actingAs($this->customer)->postJson('/api/v1/bookings', [
            'errand_type_id' => $this->type->id,
            'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.9,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.5, 'dropoff_lng' => 121.0,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'payment_method' => 'wallet',
        ]);

        $res->assertCreated();
    }
}
