<?php

namespace Tests\Feature\Payment;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Gateway-funded tips: a customer with NO wallet balance tips their runner by
 * paying directly via GCash / Maya / card. The runner is credited only after
 * Xendit confirms via webhook — never optimistically — and the credit is the
 * same (runner, booking, 'tip') row shape the wallet-funded tip writes.
 */
class GatewayTipTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.xendit.secret_key' => 'test-secret']);
        config(['services.xendit.webhook_token' => 'test-webhook-token']);

        // A DELIBERATELY zero-wallet customer — the whole point of the gateway
        // path is that they can tip without any ErrandGuy balance.
        $this->customer = User::factory()->create([
            'role' => 'customer', 'status' => 'active',
            'wallet_balance' => 0, 'email' => 'buyer@example.com',
        ]);
        $this->runner = User::factory()->create([
            'role' => 'runner', 'status' => 'active', 'wallet_balance' => 0,
        ]);
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeCompletedBooking(array $overrides = []): Booking
    {
        return Booking::create(array_merge([
            'booking_number' => 'EG-TIP-'.strtoupper(substr(md5(microtime().random_int(0, 9999)), 0, 6)),
            'customer_id' => $this->customer->id,
            'runner_id' => $this->runner->id,
            'errand_type_id' => $this->errandType->id,
            'status' => 'completed',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'payment_method' => 'cash', 'payment_status' => 'paid',
            'is_transportation' => false, 'tip_amount' => 0,
        ], $overrides));
    }

    private function webhook(array $payload)
    {
        return $this->postJson('/api/v1/webhooks/xendit', $payload, [
            'x-callback-token' => 'test-webhook-token',
        ]);
    }

    public function test_checkout_creates_a_pending_row_and_does_not_credit_the_runner_yet(): void
    {
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_tip1', 'invoice_url' => 'https://checkout.xendit.co/inv_tip1',
            ], 200),
        ]);
        $booking = $this->makeCompletedBooking();

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip-checkout", ['amount' => 50, 'method' => 'card'])
            ->assertCreated()
            ->assertJsonPath('checkout_url', 'https://checkout.xendit.co/inv_tip1')
            ->assertJsonPath('data.status', 'pending');

        // Nothing moves until the webhook confirms.
        $this->assertSame(0.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(0.0, (float) $booking->fresh()->tip_amount);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->customer->id, 'reference_id' => $booking->id,
            'type' => 'tip_payment', 'status' => 'pending', 'gateway_ref' => 'inv_tip1',
        ]);
        // No runner 'tip' credit exists yet.
        $this->assertDatabaseMissing('wallet_transactions', [
            'user_id' => $this->runner->id, 'reference_id' => $booking->id, 'type' => 'tip',
        ]);
    }

    public function test_invoice_paid_webhook_credits_the_runner_and_stamps_the_tip(): void
    {
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_tip2', 'invoice_url' => 'https://checkout.xendit.co/inv_tip2',
            ], 200),
        ]);
        $booking = $this->makeCompletedBooking();
        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip-checkout", ['amount' => 50, 'method' => 'card'])
            ->assertCreated();
        $tip = WalletTransaction::where('type', 'tip_payment')->firstOrFail();

        $this->webhook([
            'event' => 'invoice.paid',
            'data' => ['external_id' => "tip-{$tip->id}", 'id' => 'inv_tip2', 'amount' => 50],
        ])->assertOk();

        // Runner credited, booking stamped, and the customer's wallet UNMOVED
        // (they paid via the gateway, not their ErrandGuy balance).
        $this->assertSame(50.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(50.0, (float) $booking->fresh()->tip_amount);
        $this->assertSame(0.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertSame('completed', $tip->fresh()->status);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->runner->id, 'reference_id' => $booking->id,
            'type' => 'tip', 'amount' => 50,
        ]);
    }

    public function test_gateway_tip_webhook_is_idempotent(): void
    {
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_tip3', 'invoice_url' => 'https://checkout.xendit.co/inv_tip3',
            ], 200),
        ]);
        $booking = $this->makeCompletedBooking();
        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip-checkout", ['amount' => 100, 'method' => 'card'])
            ->assertCreated();
        $tip = WalletTransaction::where('type', 'tip_payment')->firstOrFail();

        $payload = [
            'event' => 'invoice.paid',
            'data' => ['external_id' => "tip-{$tip->id}", 'id' => 'inv_tip3', 'amount' => 100],
        ];
        $this->webhook($payload)->assertOk();
        $this->webhook($payload)->assertOk();

        // Credited exactly once despite two deliveries.
        $this->assertSame(100.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(1, WalletTransaction::where('user_id', $this->runner->id)
            ->where('reference_id', $booking->id)->where('type', 'tip')->count());
    }

    public function test_under_settlement_leaves_the_tip_pending_and_does_not_credit(): void
    {
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_tip4', 'invoice_url' => 'https://checkout.xendit.co/inv_tip4',
            ], 200),
        ]);
        $booking = $this->makeCompletedBooking();
        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip-checkout", ['amount' => 100, 'method' => 'card'])
            ->assertCreated();
        $tip = WalletTransaction::where('type', 'tip_payment')->firstOrFail();

        // Gateway confirms LESS than the tip → must NOT credit.
        $this->webhook([
            'event' => 'invoice.paid',
            'data' => ['external_id' => "tip-{$tip->id}", 'id' => 'inv_tip4', 'amount' => 40],
        ])->assertOk();

        $this->assertSame(0.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(0.0, (float) $booking->fresh()->tip_amount);
        $this->assertSame('pending', $tip->fresh()->status);
    }

    public function test_ewallet_gateway_tip_is_credited_via_payment_succeeded(): void
    {
        Http::fake([
            'api.xendit.co/payment_requests' => Http::response([
                'id' => 'pr_tip5', 'status' => 'PENDING',
                'actions' => [['url' => 'https://gcash.example/authorize/pr_tip5']],
            ], 200),
        ]);
        $booking = $this->makeCompletedBooking();
        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip-checkout", ['amount' => 75, 'method' => 'gcash'])
            ->assertCreated()
            ->assertJsonPath('checkout_url', 'https://gcash.example/authorize/pr_tip5');

        // Matched on gateway_ref (the payment_request id), like a direct top-up.
        $this->webhook([
            'event' => 'payment.succeeded',
            'data' => ['payment_request_id' => 'pr_tip5', 'amount' => 75],
        ])->assertOk();

        $this->assertSame(75.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(75.0, (float) $booking->fresh()->tip_amount);
    }

    public function test_payment_failed_marks_the_tip_failed_without_crediting(): void
    {
        Http::fake([
            'api.xendit.co/payment_requests' => Http::response([
                'id' => 'pr_tip6', 'status' => 'PENDING',
                'actions' => [['url' => 'https://gcash.example/authorize/pr_tip6']],
            ], 200),
        ]);
        $booking = $this->makeCompletedBooking();
        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip-checkout", ['amount' => 75, 'method' => 'gcash'])
            ->assertCreated();
        $tip = WalletTransaction::where('type', 'tip_payment')->firstOrFail();

        $this->webhook([
            'event' => 'payment.failed',
            'data' => ['payment_request_id' => 'pr_tip6'],
        ])->assertOk();

        $this->assertSame('failed', $tip->fresh()->status);
        $this->assertSame(0.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(0.0, (float) $booking->fresh()->tip_amount);
    }

    public function test_cannot_gateway_tip_an_uncompleted_errand(): void
    {
        $booking = $this->makeCompletedBooking(['status' => 'in_transit']);

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip-checkout", ['amount' => 50, 'method' => 'card'])
            ->assertStatus(422)
            ->assertJsonPath('code', 'BOOKING_STATE_INVALID');
    }

    public function test_cannot_gateway_tip_an_already_tipped_errand(): void
    {
        $booking = $this->makeCompletedBooking(['tip_amount' => 20]);

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip-checkout", ['amount' => 50, 'method' => 'card'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'CONFLICT');
    }

    public function test_a_duplicate_gateway_tip_payment_is_not_double_credited(): void
    {
        // Two pending tip charges would be a bug the initiation guard prevents,
        // but if a charge somehow settles for an already-tipped errand the
        // runner must NOT be paid twice — the collected money is flagged for a
        // manual refund instead.
        Http::fake([
            'api.xendit.co/v2/invoices' => Http::response([
                'id' => 'inv_tip7', 'invoice_url' => 'https://checkout.xendit.co/inv_tip7',
            ], 200),
        ]);
        $booking = $this->makeCompletedBooking();
        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/tip-checkout", ['amount' => 50, 'method' => 'card'])
            ->assertCreated();
        $tip = WalletTransaction::where('type', 'tip_payment')->firstOrFail();

        // Simulate the errand already tipped some other way.
        $booking->update(['tip_amount' => 30]);

        $this->webhook([
            'event' => 'invoice.paid',
            'data' => ['external_id' => "tip-{$tip->id}", 'id' => 'inv_tip7', 'amount' => 50],
        ])->assertOk();

        // Runner NOT credited from this charge; tip row resolved but flagged.
        $this->assertSame(0.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(30.0, (float) $booking->fresh()->tip_amount);
        $this->assertSame('completed', $tip->fresh()->status);
        $this->assertNotNull($tip->fresh()->failure_reason);
    }
}
