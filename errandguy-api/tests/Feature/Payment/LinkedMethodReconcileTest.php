<?php

namespace Tests\Feature\Payment;

use App\Models\PaymentMethod;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Linking must complete without depending on the `payment_method.activated`
 * webhook: the payment-methods list confirms any still-`pending` method
 * directly with the gateway. This is what lets a linked GCash/Maya be charged
 * in-app afterwards (no fresh checkout redirect per payment).
 */
class LinkedMethodReconcileTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.xendit.secret_key' => 'test-secret']);
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
    }

    private function pendingMethod(): PaymentMethod
    {
        return PaymentMethod::create([
            'user_id' => $this->customer->id,
            'type' => 'gcash',
            'status' => 'pending',
            'label' => 'GCash',
            'gateway_ref' => 'pm-test-123',
            'channel_code' => 'GCASH',
            'is_default' => false,
        ]);
    }

    public function test_pending_method_activates_from_gateway_status_on_list_fetch(): void
    {
        Http::fake([
            'api.xendit.co/v2/payment_methods/*' => Http::response(['id' => 'pm-test-123', 'status' => 'ACTIVE'], 200),
        ]);

        $method = $this->pendingMethod();

        $this->actingAs($this->customer)
            ->getJson('/api/v1/payments/methods')
            ->assertOk()
            ->assertJsonPath('data.0.status', 'active')
            ->assertJsonPath('data.0.is_default', true); // first active → default

        $this->assertSame('active', $method->fresh()->status);
    }

    public function test_still_pending_gateway_status_leaves_method_pending(): void
    {
        Http::fake([
            'api.xendit.co/v2/payment_methods/*' => Http::response(['status' => 'PENDING'], 200),
        ]);

        $method = $this->pendingMethod();

        $this->actingAs($this->customer)
            ->getJson('/api/v1/payments/methods')
            ->assertOk()
            ->assertJsonPath('data.0.status', 'pending');

        $this->assertSame('pending', $method->fresh()->status);
    }

    public function test_failed_gateway_status_drops_the_method_from_the_list(): void
    {
        Http::fake([
            'api.xendit.co/v2/payment_methods/*' => Http::response(['status' => 'FAILED'], 200),
        ]);

        $this->pendingMethod();

        $this->actingAs($this->customer)
            ->getJson('/api/v1/payments/methods')
            ->assertOk()
            ->assertJsonCount(0, 'data'); // reconciled to failed → hidden from the list
    }
}
