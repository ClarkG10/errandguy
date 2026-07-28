<?php

namespace Tests\Feature\Payment;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\User;
use App\Services\PaymentService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Payment review P0-1/4/5: hybrid, honest, safe refunds.
 * - Card → real Xendit gateway reversal (refunded_to=gateway).
 * - Wallet/GCash/Maya → in-app wallet credit (refunded_to=wallet).
 * - Cash → rejected (the platform never held the money).
 * - Every refund syncs booking.payment_status and cannot double-credit.
 */
class RefundSemanticsTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $type;
    private array $base;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        config(['services.xendit.secret_key' => 'test-secret']);

        $this->customer = User::factory()->create([
            'role' => 'customer', 'status' => 'active', 'wallet_balance' => 0,
        ]);
        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'x',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'surcharge' => 0.00, 'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
        $this->base = [
            'errand_type_id' => $this->type->id,
            'pickup_address' => '123 Main St', 'pickup_lat' => 14.5995, 'pickup_lng' => 120.9842,
            'dropoff_address' => '456 Oak Ave', 'dropoff_lat' => 14.5547, 'dropoff_lng' => 121.0244,
            'description' => 'Package', 'schedule_type' => 'now',
            'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
        ];
    }

    private function bookViaWallet(): Booking
    {
        Bus::fake();
        $this->customer->update(['wallet_balance' => 5000]);
        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'wallet'])
            ->assertCreated();

        return Booking::firstOrFail();
    }

    public function test_wallet_payment_refunds_to_wallet_and_syncs_booking(): void
    {
        $booking = $this->bookViaWallet();
        $payment = Payment::where('booking_id', $booking->id)->firstOrFail();
        $fare = (float) $booking->total_amount;
        $balanceAfterBooking = (float) $this->customer->fresh()->wallet_balance;

        app(PaymentService::class)->refundToWallet($payment->id, 'test');

        $this->assertEqualsWithDelta($balanceAfterBooking + $fare, (float) $this->customer->fresh()->wallet_balance, 0.001);
        $payment->refresh();
        $this->assertEquals('refunded', $payment->status);
        $this->assertEquals('wallet', $payment->refunded_to);
        $this->assertEqualsWithDelta($fare, (float) $payment->refund_amount, 0.001);
        $this->assertEquals('refunded', $booking->fresh()->payment_status);
    }

    public function test_wallet_refund_cannot_be_double_credited(): void
    {
        $booking = $this->bookViaWallet();
        $payment = Payment::where('booking_id', $booking->id)->firstOrFail();

        app(PaymentService::class)->refundToWallet($payment->id, 'first');
        $balance = (float) $this->customer->fresh()->wallet_balance;

        // Second attempt is rejected (already refunded) — no second credit.
        $this->expectException(\RuntimeException::class);
        try {
            app(PaymentService::class)->refundToWallet($payment->id, 'again');
        } finally {
            $this->assertEqualsWithDelta($balance, (float) $this->customer->fresh()->wallet_balance, 0.001);
        }
    }

    public function test_cash_payment_cannot_be_refunded_to_wallet(): void
    {
        Bus::fake();
        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'cash'])
            ->assertCreated();
        $payment = Payment::firstOrFail();
        $balance = (float) $this->customer->fresh()->wallet_balance;

        $this->expectException(\RuntimeException::class);
        try {
            app(PaymentService::class)->refundToWallet($payment->id, 'x');
        } finally {
            $this->assertEqualsWithDelta($balance, (float) $this->customer->fresh()->wallet_balance, 0.001);
        }
    }

    public function test_card_payment_is_reversed_at_the_gateway(): void
    {
        $booking = $this->bookViaWallet();
        // A completed card charge on the same booking.
        $card = Payment::create([
            'booking_id' => $booking->id, 'customer_id' => $this->customer->id,
            'amount' => 100.00, 'currency' => 'PHP', 'method' => 'card',
            'status' => 'completed', 'gateway_tx_id' => 'pr-test-1', 'paid_at' => now(),
        ]);
        Http::fake(['api.xendit.co/refunds' => Http::response(['id' => 'rfd-1', 'status' => 'SUCCEEDED'], 200)]);

        app(PaymentService::class)->refundPayment($card->id, null, 'test');

        $card->refresh();
        $this->assertEquals('refunded', $card->status);
        $this->assertEquals('gateway', $card->refunded_to);
        $this->assertEqualsWithDelta(100.00, (float) $card->refund_amount, 0.001);
        $this->assertEquals('refunded', $booking->fresh()->payment_status);
        Http::assertSent(fn ($r) => str_contains($r->url(), '/refunds'));
    }

    public function test_card_refund_without_gateway_reference_is_rejected(): void
    {
        $booking = $this->bookViaWallet();
        $card = Payment::create([
            'booking_id' => $booking->id, 'customer_id' => $this->customer->id,
            'amount' => 100.00, 'currency' => 'PHP', 'method' => 'card',
            'status' => 'completed', 'gateway_tx_id' => null, 'paid_at' => now(),
        ]);

        $this->expectException(\RuntimeException::class);
        app(PaymentService::class)->refundPayment($card->id, null, 'test');
    }
}
