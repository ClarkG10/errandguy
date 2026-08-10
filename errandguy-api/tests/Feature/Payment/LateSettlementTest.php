<?php

namespace Tests\Feature\Payment;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Services\BookingSettlementService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * MONEY-1 / MONEY-3 / MONEYX-2 regression: a gateway charge that settles at a
 * DIFFERENT time than the booking reaches its resting state.
 *
 *  - settles AFTER completion  → the runner earning completion couldn't credit
 *    (the charge was still pending then) is BACK-FILLED (MONEY-1).
 *  - settles AFTER cancellation → the charge is auto-REFUNDED to the customer
 *    instead of a cancelled booking being laundered to 'paid' (MONEY-3 / -X2).
 */
class LateSettlementTest extends TestCase
{
    use RefreshDatabase;

    private string $webhookToken = 'xnd_test_callback_token_for_testing';
    private User $customer;
    private User $runner;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        config(['services.xendit.webhook_token' => $this->webhookToken]);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 0]);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 0]);
        RunnerProfile::create([
            'user_id' => $this->runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'preferred_types' => [], 'total_errands' => 1, 'total_earnings' => 0.00, 'completion_rate' => 100.00,
        ]);
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50.00, 'per_km_walk' => 15.00, 'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00,
            'per_km_car' => 18.00, 'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeBooking(string $status, array $overrides = []): Booking
    {
        return Booking::create(array_merge([
            'booking_number' => 'EG-20260808-'.strtoupper(substr(md5($status.microtime(true)), 0, 4)),
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $this->errandType->id, 'status' => $status,
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 100,
            'payment_method' => 'gcash', 'payment_status' => 'pending', 'is_transportation' => false,
        ], $overrides));
    }

    private function makePayment(Booking $booking, string $prId): Payment
    {
        return Payment::create([
            'booking_id' => $booking->id, 'customer_id' => $this->customer->id,
            'amount' => 115.00, 'currency' => 'PHP', 'method' => 'gcash',
            'status' => 'pending', 'gateway_tx_id' => $prId,
        ]);
    }

    private function postSucceeded(string $prId): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'payment.succeeded',
            'data' => ['id' => 'ddpy_'.$prId, 'payment_request_id' => $prId, 'status' => 'SUCCEEDED', 'amount' => 115.00],
        ], ['x-callback-token' => $this->webhookToken]);
    }

    public function test_charge_settling_after_completion_backfills_the_runner_earning(): void
    {
        $booking = $this->makeBooking('completed');
        $this->makePayment($booking, 'pr_late_complete');

        $this->postSucceeded('pr_late_complete')->assertOk();

        // Runner is finally credited the payout completion couldn't credit.
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->runner->id, 'type' => 'earning', 'reference_id' => $booking->id, 'amount' => '100.00',
        ]);
        $this->assertEquals('100.00', $this->runner->fresh()->wallet_balance);
        $this->assertDatabaseHas('runner_profiles', ['user_id' => $this->runner->id, 'total_earnings' => '100.00']);
        $this->assertEquals('paid', $booking->fresh()->payment_status);
    }

    public function test_charge_settling_after_cancellation_is_auto_refunded(): void
    {
        // Cancelled while the charge was in flight; no fee was collectible at
        // cancel time (nothing was paid), so the whole fare is returned.
        $booking = $this->makeBooking('cancelled', ['cancellation_fee' => 0]);
        $this->makePayment($booking, 'pr_late_cancel');

        $this->postSucceeded('pr_late_cancel')->assertOk();

        $this->assertEquals('0.00', $this->runner->fresh()->wallet_balance); // runner untouched
        $this->assertEquals('115.00', $this->customer->fresh()->wallet_balance);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund', 'reference_id' => $booking->id, 'amount' => '115.00',
        ]);
        $this->assertEquals('refunded', $booking->fresh()->payment_status);
        $this->assertDatabaseHas('payments', ['booking_id' => $booking->id, 'status' => 'refunded']);
    }

    public function test_webhook_redelivery_resettles_an_already_completed_charge(): void
    {
        // MC-2 self-heal: the first delivery marked the charge Completed +
        // payment_status 'paid' but its settlement was dropped (e.g. a transient
        // DB lock), so no earning exists. Xendit redelivers payment.succeeded;
        // the payment is already Completed (canAdvance=false) so the tx no-ops,
        // but settlement must still run for the completed booking and back-fill.
        $booking = $this->makeBooking('completed', ['payment_status' => 'paid']);
        $payment = $this->makePayment($booking, 'pr_redeliver');
        $payment->update(['status' => 'completed', 'paid_at' => now()]);
        $this->assertSame(0, \App\Models\WalletTransaction::where('reference_id', $booking->id)->where('type', 'earning')->count());

        $this->postSucceeded('pr_redeliver')->assertOk();

        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->runner->id, 'type' => 'earning', 'reference_id' => $booking->id, 'amount' => '100.00',
        ]);
        $this->assertEquals('100.00', $this->runner->fresh()->wallet_balance);
    }

    public function test_charge_settling_after_cancellation_AND_account_deletion_still_refunds(): void
    {
        // XREG-1: the customer cancelled a still-in-flight gateway booking, then
        // deleted their account (soft-delete). The charge later settles. The
        // auto-refund must still record + mark the payment Refunded rather than
        // throw ModelNotFoundException (soft-delete scope) and 500-loop the hook.
        $booking = $this->makeBooking('cancelled', ['cancellation_fee' => 0]);
        $this->makePayment($booking, 'pr_deleted_cancel');
        $this->customer->delete(); // soft-delete the account

        $this->postSucceeded('pr_deleted_cancel')->assertOk();

        $this->assertEquals('refunded', $booking->fresh()->payment_status);
        $this->assertDatabaseHas('payments', ['booking_id' => $booking->id, 'status' => 'refunded']);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund', 'reference_id' => $booking->id, 'amount' => '115.00',
        ]);
    }

    public function test_backfill_is_idempotent(): void
    {
        $booking = $this->makeBooking('completed', ['payment_status' => 'paid']);
        $payment = $this->makePayment($booking, 'pr_idem');
        $payment->update(['status' => 'completed', 'paid_at' => now()]);

        $svc = app(BookingSettlementService::class);
        $svc->settlePaidBooking($payment->fresh());
        $svc->settlePaidBooking($payment->fresh());

        $this->assertSame(1, \App\Models\WalletTransaction::where('reference_id', $booking->id)->where('type', 'earning')->count());
        $this->assertEquals('100.00', $this->runner->fresh()->wallet_balance);
    }

    public function test_cancelled_refund_is_idempotent(): void
    {
        $booking = $this->makeBooking('cancelled', ['payment_status' => 'paid', 'cancellation_fee' => 0]);
        $payment = $this->makePayment($booking, 'pr_cancel_idem');
        $payment->update(['status' => 'completed', 'paid_at' => now()]);

        $svc = app(BookingSettlementService::class);
        $svc->settlePaidBooking($payment->fresh());
        $svc->settlePaidBooking($payment->fresh());

        $this->assertSame(1, \App\Models\WalletTransaction::where('reference_id', $booking->id)->where('type', 'refund')->count());
        $this->assertEquals('115.00', $this->customer->fresh()->wallet_balance);
    }
}
