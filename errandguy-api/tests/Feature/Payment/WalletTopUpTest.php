<?php

namespace Tests\Feature\Payment;

use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class WalletTopUpTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.xendit.secret_key' => 'test-secret']);
        config(['services.xendit.webhook_token' => 'test-webhook-token']);
        $this->user = User::factory()->create([
            'role' => 'customer',
            'status' => 'active',
            'wallet_balance' => 100.00,
            'email' => 'buyer@example.com',
        ]);
    }

    public function test_top_up_creates_pending_transaction_and_does_not_credit_balance(): void
    {
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_123',
                'invoice_url' => 'https://checkout.xendit.co/inv_123',
            ], 200),
        ]);

        $response = $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 500]);

        $response->assertCreated()
            ->assertJsonPath('checkout_url', 'https://checkout.xendit.co/inv_123')
            ->assertJsonPath('data.status', 'pending');

        // Balance must be UNCHANGED until the webhook confirms payment.
        $this->assertEquals(100.00, (float) $this->user->fresh()->wallet_balance);

        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->user->id,
            'type' => 'top_up',
            'status' => 'pending',
            'gateway_ref' => 'inv_123',
        ]);
    }

    public function test_invoice_paid_webhook_credits_wallet(): void
    {
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_abc',
                'invoice_url' => 'https://checkout.xendit.co/inv_abc',
            ], 200),
        ]);

        $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 500])
            ->assertCreated();

        $tx = WalletTransaction::where('user_id', $this->user->id)->firstOrFail();

        $webhook = $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'invoice.paid',
            'data' => ['external_id' => "topup-{$tx->id}", 'id' => 'inv_abc', 'status' => 'PAID'],
        ], ['x-callback-token' => 'test-webhook-token']);

        $webhook->assertOk();

        $this->assertEquals(600.00, (float) $this->user->fresh()->wallet_balance);
        $this->assertEquals('completed', $tx->fresh()->status);
        $this->assertEquals(600.00, (float) $tx->fresh()->balance_after);
    }

    public function test_invoice_paid_webhook_is_idempotent(): void
    {
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_xyz', 'invoice_url' => 'https://checkout.xendit.co/inv_xyz',
            ], 200),
        ]);

        $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 300])
            ->assertCreated();
        $tx = WalletTransaction::where('user_id', $this->user->id)->firstOrFail();

        $payload = [
            'event' => 'invoice.paid',
            'data' => ['external_id' => "topup-{$tx->id}", 'id' => 'inv_xyz'],
        ];
        $headers = ['x-callback-token' => 'test-webhook-token'];

        $this->postJson('/api/v1/webhooks/xendit', $payload, $headers)->assertOk();
        $this->postJson('/api/v1/webhooks/xendit', $payload, $headers)->assertOk();

        // Credited exactly once despite two deliveries.
        $this->assertEquals(400.00, (float) $this->user->fresh()->wallet_balance);
    }

    public function test_webhook_rejects_invalid_token(): void
    {
        $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'invoice.paid',
            'data' => ['external_id' => 'topup-nonexistent'],
        ], ['x-callback-token' => 'wrong-token'])->assertStatus(400);
    }

    public function test_top_up_below_minimum_is_rejected(): void
    {
        $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 10])
            ->assertStatus(422);
    }
}
