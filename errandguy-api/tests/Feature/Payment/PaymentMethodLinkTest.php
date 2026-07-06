<?php

namespace Tests\Feature\Payment;

use App\Models\ErrandType;
use App\Models\PaymentMethod;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PaymentMethodLinkTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.xendit.secret_key' => 'test-secret']);
        config(['services.xendit.webhook_token' => 'test-webhook-token']);
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        $this->customer = User::factory()->create([
            'role' => 'customer', 'status' => 'active', 'wallet_balance' => 0,
            'email' => 'linker@example.com',
        ]);
    }

    public function test_linking_ewallet_creates_pending_method_and_returns_action_url(): void
    {
        Http::fake([
            'api.xendit.co/customers' => Http::response(['id' => 'cust-1'], 200),
            'api.xendit.co/v2/payment_methods' => Http::response([
                'id' => 'pm-1',
                'status' => 'PENDING',
                'actions' => [['url' => 'https://xendit.example/authorize/pm-1', 'url_type' => 'WEB']],
            ], 200),
        ]);

        $res = $this->actingAs($this->customer)
            ->postJson('/api/v1/payments/methods/link', ['channel' => 'maya']);

        $res->assertCreated()
            ->assertJsonPath('data.type', 'maya')
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('action_url', 'https://xendit.example/authorize/pm-1');

        // Xendit customer id is persisted for reuse.
        $this->assertEquals('cust-1', $this->customer->fresh()->xendit_customer_id);
        $this->assertDatabaseHas('payment_methods', [
            'user_id' => $this->customer->id,
            'type' => 'maya',
            'status' => 'pending',
            'gateway_ref' => 'pm-1',
        ]);
    }

    public function test_activation_webhook_marks_method_active(): void
    {
        $method = PaymentMethod::create([
            'user_id' => $this->customer->id, 'type' => 'maya', 'status' => 'pending',
            'label' => 'Maya', 'gateway_ref' => 'pm-9', 'channel_code' => 'PAYMAYA',
        ]);

        $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'payment_method.activated',
            'data' => ['id' => 'pm-9', 'status' => 'ACTIVE'],
        ], ['x-callback-token' => 'test-webhook-token'])->assertOk();

        $this->assertEquals('active', $method->fresh()->status);
    }

    public function test_pending_methods_are_listed_but_expired_are_hidden(): void
    {
        PaymentMethod::create([
            'user_id' => $this->customer->id, 'type' => 'maya', 'status' => 'active',
            'label' => 'Maya', 'gateway_ref' => 'pm-a', 'channel_code' => 'PAYMAYA',
        ]);
        PaymentMethod::create([
            'user_id' => $this->customer->id, 'type' => 'gcash', 'status' => 'expired',
            'label' => 'GCash', 'gateway_ref' => 'pm-b', 'channel_code' => 'GCASH',
        ]);

        $res = $this->actingAs($this->customer)->getJson('/api/v1/payments/methods');
        $res->assertOk();
        $types = collect($res->json('data'))->pluck('type')->all();
        $this->assertContains('maya', $types);
        $this->assertNotContains('gcash', $types);
    }

    public function test_booking_with_linked_method_charges_token_and_marks_paid(): void
    {
        Bus::fake();
        Http::fake([
            'api.xendit.co/payment_requests' => Http::response([
                'id' => 'pr-1', 'status' => 'SUCCEEDED',
            ], 200),
        ]);

        $method = PaymentMethod::create([
            'user_id' => $this->customer->id, 'type' => 'maya', 'status' => 'active',
            'label' => 'Maya', 'gateway_ref' => 'pm-active', 'channel_code' => 'PAYMAYA',
        ]);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'x', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);

        $res = $this->actingAs($this->customer)->postJson('/api/v1/bookings', [
            'errand_type_id' => $type->id,
            'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.9,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.5, 'dropoff_lng' => 121.0,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'payment_method' => 'maya',
            'payment_method_id' => $method->id,
        ]);

        $res->assertCreated();
        $this->assertDatabaseHas('payments', [
            'method' => 'maya',
            'status' => 'completed',
            'gateway_tx_id' => 'pr-1',
        ]);
    }
}
