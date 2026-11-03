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
 * - Only for an errand that is over: while it is live, staff cancel it instead
 *   (cancelling refunds it), or it would run for free.
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
            'surcharge' => 0.00, 'is_active' => true, 'sort_order' => 1,
        ]);
        $this->base = [
            'errand_type_id' => $this->type->id,
            'pickup_address' => '123 Main St', 'pickup_lat' => 14.5995, 'pickup_lng' => 120.9842,
            'dropoff_address' => '456 Oak Ave', 'dropoff_lat' => 14.5547, 'dropoff_lng' => 121.0244,
            'description' => 'Package', 'schedule_type' => 'now',
            'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
        ];
    }

    /** A wallet-paid errand, done ("completed" unless told otherwise) — what staff refund. */
    private function bookViaWallet(string $status = 'completed'): Booking
    {
        Bus::fake();
        $this->customer->update(['wallet_balance' => 5000]);
        $id = $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'wallet'])
            ->assertCreated()
            ->json('data.id');

        $booking = Booking::findOrFail($id);
        $booking->update(['status' => $status]);

        return $booking;
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

    public function test_admin_wallet_refund_of_a_bonus_funded_booking_restores_bonus_not_cash(): void
    {
        // Regression for the reference-mismatch leak: the wallet debit is keyed
        // on booking id, the refund on payment id — refundToWallet must pass the
        // booking id so the bonus/withdrawable split is recovered and the
        // non-withdrawable bonus is NOT laundered into cashable wallet balance.
        Bus::fake();
        $this->customer->update(['wallet_balance' => 0, 'bonus_balance' => 5000]);
        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', [...$this->base, 'payment_method' => 'wallet'])
            ->assertCreated();
        $booking = Booking::firstOrFail();
        $booking->update(['status' => 'completed']);
        $payment = Payment::where('booking_id', $booking->id)->firstOrFail();
        $fare = (float) $booking->total_amount;

        // Paid entirely from the non-withdrawable bonus bucket.
        $this->assertEqualsWithDelta(5000 - $fare, (float) $this->customer->fresh()->bonus_balance, 0.001);
        $this->assertEquals(0.0, (float) $this->customer->fresh()->wallet_balance);

        app(PaymentService::class)->refundToWallet($payment->id, 'test');

        // Refund returns to BONUS, not to the withdrawable wallet.
        $this->assertEqualsWithDelta(5000, (float) $this->customer->fresh()->bonus_balance, 0.001);
        $this->assertEquals(0.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertEquals('wallet', $payment->fresh()->refunded_to);
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
        Booking::query()->update(['status' => 'completed']);
        $payment = Payment::firstOrFail();
        $payment->update(['status' => 'completed']);
        $balance = (float) $this->customer->fresh()->wallet_balance;

        $this->expectExceptionMessage('Cash is settled directly with the runner');
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

    public function test_a_live_errand_is_never_refunded_here_staff_cancel_it_instead(): void
    {
        Http::fake(['api.xendit.co/refunds' => Http::response(['id' => 'rfd-1'], 200)]);

        foreach (['pending', 'matched', 'accepted', 'picked_up', 'arrived_at_dropoff', 'delivered'] as $i => $status) {
            $booking = $this->bookViaWallet($status);
            $payment = Payment::where('booking_id', $booking->id)->firstOrFail();
            $balance = (float) $this->customer->fresh()->wallet_balance;

            try {
                app(PaymentService::class)->refundToWallet($payment->id, 'test');
                $this->fail("a {$status} errand was refunded");
            } catch (\RuntimeException $e) {
                $this->assertStringContainsString('Cancel the errand instead', $e->getMessage());
            }

            $card = Payment::create([
                'booking_id' => $booking->id, 'customer_id' => $this->customer->id,
                'amount' => 100.00, 'currency' => 'PHP', 'method' => 'card',
                'status' => 'completed', 'gateway_tx_id' => "pr-live-{$i}", 'paid_at' => now(),
            ]);
            try {
                app(PaymentService::class)->refundPayment($card->id, null, 'test');
                $this->fail("a {$status} errand's card charge was reversed");
            } catch (\RuntimeException $e) {
                $this->assertStringContainsString('Cancel the errand instead', $e->getMessage());
            }

            $this->assertEqualsWithDelta($balance, (float) $this->customer->fresh()->wallet_balance, 0.001);
            $this->assertSame('completed', $payment->fresh()->status);
            $this->assertSame('paid', $booking->fresh()->payment_status);
        }

        Http::assertNothingSent();
    }

    public function test_an_errand_that_is_over_can_be_refunded(): void
    {
        foreach (['completed', 'cancelled', 'no_runner'] as $status) {
            $booking = $this->bookViaWallet($status);
            $payment = Payment::where('booking_id', $booking->id)->firstOrFail();

            app(PaymentService::class)->refundToWallet($payment->id, 'test');

            $this->assertSame('refunded', $payment->fresh()->status, $status);
        }
    }

    public function test_the_refund_action_is_not_offered_on_a_live_errand(): void
    {
        // A live errand is refunded by cancelling it (the errand page has
        // Cancel), so the Refund button isn't shown for one — it used to open a
        // dialog whose confirm did nothing.
        $booking = $this->bookViaWallet('accepted');
        $payment = Payment::where('booking_id', $booking->id)->firstOrFail();
        $this->actingAs(\App\Models\AdminUser::create([
            'email' => 'finance@errandguy.test', 'password_hash' => 'x',
            'full_name' => 'Finance', 'role' => 'finance', 'is_active' => true,
        ]), 'admin');

        \Livewire\Livewire::test(\App\Filament\Resources\Payments\Pages\ListPayments::class)
            ->assertTableActionHidden('refund', $payment);

        // And the service still refuses it if called anyway.
        try {
            app(PaymentService::class)->refundToWallet($payment->id, 'test');
        } catch (\Throwable) {
        }
        $this->assertSame('completed', $payment->fresh()->status);
        $this->assertSame('paid', $booking->fresh()->payment_status);
    }

    public function test_a_completed_errand_refund_says_the_runner_keeps_their_pay_and_large_ones_alert(): void
    {
        $booking = $this->bookViaWallet('completed');
        $booking->update(['runner_payout' => 85]);
        $payment = Payment::where('booking_id', $booking->id)->firstOrFail();
        \App\Models\SystemConfig::updateOrCreate(['key' => 'admin_adjustment_alert_threshold'], ['value' => '100']);
        $this->assertGreaterThanOrEqual(100, (float) $payment->amount);
        $this->actingAs(\App\Models\AdminUser::create([
            'email' => 'finance@errandguy.test', 'password_hash' => 'x',
            'full_name' => 'Finance', 'role' => 'finance', 'is_active' => true,
        ]), 'admin');

        \Livewire\Livewire::test(\App\Filament\Resources\Payments\Pages\ListPayments::class)
            ->mountTableAction('refund', $payment)
            ->assertMountedActionModalSee('the runner keeps their ₱85.00 earning');

        \Livewire\Livewire::test(\App\Filament\Resources\Payments\Pages\ListPayments::class)
            ->callTableAction('refund', $payment, ['reason' => 'Items arrived damaged']);

        $this->assertSame('refunded', $payment->fresh()->status);
        $alert = \App\Models\AdminAlert::where('type', \App\Services\StaffMoneyLimit::ALERT_REFUND)->sole();
        $this->assertStringContainsString('Items arrived damaged', $alert->body);
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
