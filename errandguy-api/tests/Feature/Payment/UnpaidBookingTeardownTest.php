<?php

namespace Tests\Feature\Payment;

use App\Enums\PaymentStatus;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\User;
use App\Services\PaymentService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The abandoned checkout that still sends a runner.
 *
 * An online booking is matched — and can be accepted and completed — BEFORE its
 * charge is captured: MatchRunnerJob gates on status only and accept() has no
 * payment gate. So when the customer opens GCash and taps decline, something has
 * to tear the booking down, or the runner drives out, completes the errand, and
 * is credited nothing.
 *
 * The webhook path was given that teardown. The PULL RECONCILER was not — and it
 * is the path that usually wins: the app polls the status endpoint every 3s from
 * the moment checkout opens, so the poll routinely terminalizes the charge first,
 * which then permanently DISARMS the webhook (canAdvance=false ⇒ its post-commit
 * teardown never runs). The most common abandonment in the product was therefore
 * the one case with no teardown at all.
 *
 * These lock down that both settlement paths share ONE teardown, and that it
 * stays conservative: it must never tear down an errand that is already finished
 * or one whose money actually arrived.
 */
class UnpaidBookingTeardownTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private Booking $booking;
    private Payment $payment;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush(); // the reconciler's per-payment pull throttle is a cache latch
        config(['services.xendit.secret_key' => 'test-secret']);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        // The dangerous shape: a runner is already assigned and on the job while
        // the charge is still uncaptured.
        $this->booking = Booking::create([
            'booking_number' => 'EG-20260906-TEAR',
            'customer_id' => $this->customer->id,
            'runner_id' => $this->runner->id,
            'errand_type_id' => $errandType->id,
            'status' => 'accepted',
            'payment_status' => 'pending',
            'payment_method' => 'gcash',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);

        $this->payment = Payment::create([
            'booking_id' => $this->booking->id,
            'customer_id' => $this->customer->id,
            'amount' => 115.00,
            'currency' => 'PHP',
            'method' => 'gcash',
            'status' => PaymentStatus::Processing->value,
            'gateway_tx_id' => 'pr_teardown_1',
        ]);
    }

    private function fakeGateway(string $status): void
    {
        Http::preventStrayRequests();
        Http::fake([
            'api.xendit.co/payment_requests/*' => Http::response(
                ['id' => 'pr_teardown_1', 'status' => $status, 'amount' => 115],
                200,
            ),
        ]);
    }

    private function reconcile(): void
    {
        app(PaymentService::class)->reconcileBookingPayment($this->payment);
    }

    public function test_reconciler_cancels_the_live_booking_when_the_customer_declines(): void
    {
        $this->fakeGateway('FAILED');

        $this->reconcile();

        $booking = $this->booking->fresh();
        $this->assertSame('cancelled', $booking->status, 'the declined checkout must release the runner');
        $this->assertNotNull($booking->cancelled_at);
        $this->assertNotEmpty($booking->cancellation_reason);
        $this->assertDatabaseHas('booking_status_logs', [
            'booking_id' => $this->booking->id,
            'status' => 'cancelled',
        ]);
    }

    public function test_reconciler_cancels_the_live_booking_when_the_checkout_window_expires(): void
    {
        $this->fakeGateway('EXPIRED');

        $this->reconcile();

        $this->assertSame('cancelled', $this->booking->fresh()->status);
    }

    public function test_a_finished_errand_is_never_torn_down_by_a_late_failure(): void
    {
        // The runner completed before the charge terminalized — settlement
        // back-fills the earning; cancelling here would erase a delivered errand.
        $this->booking->update(['status' => 'completed']);
        $this->fakeGateway('FAILED');

        $this->reconcile();

        $this->assertSame('completed', $this->booking->fresh()->status);
    }

    public function test_a_booking_whose_money_actually_arrived_is_never_torn_down_or_downgraded(): void
    {
        // The real multi-attempt shape: attempt #1 (this payment) fails, the
        // customer retries and attempt #2 settles the booking. Attempt #1 then
        // terminalizes LATE. It must neither mark the paid errand unpaid nor
        // cancel it out from under the runner.
        $this->booking->update(['payment_status' => 'paid']);
        $this->fakeGateway('FAILED');

        $this->reconcile();

        $booking = $this->booking->fresh();
        $this->assertSame('accepted', $booking->status, 'a paid errand must survive a stale failed attempt');
        $this->assertSame('paid', $booking->payment_status, 'a stale failure must not downgrade a paid booking');
    }
}
