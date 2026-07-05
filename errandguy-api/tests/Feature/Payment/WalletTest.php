<?php

namespace Tests\Feature\Payment;

use App\Models\PaymentMethod;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class WalletTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create([
            'role' => 'customer',
            'status' => 'active',
            'wallet_balance' => 500.00,
        ]);
    }

    public function test_user_can_get_wallet_balance(): void
    {
        $response = $this->actingAs($this->user)
            ->getJson('/api/v1/wallet/balance');

        $response->assertOk()
            ->assertJsonPath('data.balance', 500);
    }

    public function test_user_can_top_up_wallet(): void
    {
        // Top-up now creates a Xendit invoice and only credits the wallet
        // once the invoice.paid webhook confirms — so a successful request
        // returns a checkout URL and a PENDING transaction, and does NOT
        // change the balance yet.
        config(['services.xendit.secret_key' => 'test-secret']);
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_test', 'invoice_url' => 'https://checkout.xendit.co/inv_test',
            ], 200),
        ]);

        $response = $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 200]);

        $response->assertStatus(201)
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('checkout_url', 'https://checkout.xendit.co/inv_test');

        // Balance unchanged until webhook confirmation.
        $this->assertEquals('500.00', $this->user->fresh()->wallet_balance);

        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->user->id,
            'type' => 'top_up',
            'amount' => 200.00,
            'status' => 'pending',
        ]);
    }

    public function test_top_up_validates_minimum_amount(): void
    {
        $response = $this->actingAs($this->user)
            ->postJson('/api/v1/wallet/top-up', ['amount' => 10]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['amount']);
    }

    public function test_user_can_view_transactions(): void
    {
        WalletTransaction::create([
            'user_id' => $this->user->id,
            'type' => 'top_up',
            'amount' => 200.00,
            'balance_after' => 700.00,
            'description' => 'Wallet top-up',
        ]);

        WalletTransaction::create([
            'user_id' => $this->user->id,
            'type' => 'payment',
            'amount' => -100.00,
            'balance_after' => 600.00,
            'description' => 'Payment for booking',
        ]);

        $response = $this->actingAs($this->user)
            ->getJson('/api/v1/wallet/transactions');

        $response->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_user_can_filter_transactions_by_type(): void
    {
        WalletTransaction::create([
            'user_id' => $this->user->id,
            'type' => 'top_up',
            'amount' => 200.00,
            'balance_after' => 700.00,
            'description' => 'Top-up',
        ]);

        WalletTransaction::create([
            'user_id' => $this->user->id,
            'type' => 'payment',
            'amount' => -100.00,
            'balance_after' => 600.00,
            'description' => 'Payment',
        ]);

        $response = $this->actingAs($this->user)
            ->getJson('/api/v1/wallet/transactions?type=top_up');

        $response->assertOk();
        $data = $response->json('data');
        foreach ($data as $tx) {
            $this->assertEquals('top_up', $tx['type']);
        }
    }

    public function test_unauthenticated_user_cannot_access_wallet(): void
    {
        $response = $this->getJson('/api/v1/wallet/balance');
        $response->assertStatus(401);
    }
}
