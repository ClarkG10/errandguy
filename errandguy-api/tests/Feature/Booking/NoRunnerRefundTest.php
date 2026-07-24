<?php

namespace Tests\Feature\Booking;

use App\Jobs\MatchRunnerJob;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\BookingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

class NoRunnerRefundTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        $this->customer = User::factory()->create([
            'role' => 'customer', 'status' => 'active', 'wallet_balance' => 0,
        ]);
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeBooking(string $method, string $paymentStatus): Booking
    {
        $booking = Booking::create([
            'booking_number' => 'EG-20260331-'.strtoupper(substr(md5($method.$paymentStatus.microtime()), 0, 4)),
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'pending',
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'payment_method' => $method, 'payment_status' => $paymentStatus,
            'is_transportation' => false,
        ]);

        if ($paymentStatus === 'paid') {
            Payment::create([
                'booking_id' => $booking->id, 'customer_id' => $this->customer->id,
                'amount' => 115, 'method' => $method, 'status' => 'completed', 'paid_at' => now(),
            ]);
        }

        return $booking;
    }

    public function test_auto_cancel_does_not_clobber_a_booking_a_runner_just_accepted(): void
    {
        // Race guard: a runner accepted (status=accepted, paid) in the window
        // before the timeout job ran. The job must NOT cancel/refund it.
        Event::fake();
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $booking = $this->makeBooking('wallet', 'paid');
        $booking->update(['status' => 'accepted', 'runner_id' => $runner->id]);
        // Force the timeout to have elapsed.
        $booking->update(['created_at' => now()->subHours(2)]);

        (new \App\Jobs\AutoCancelBookingJob($booking->id))->handle();

        $this->assertEquals('accepted', $booking->fresh()->status);
        $this->assertEquals('paid', $booking->fresh()->payment_status);
        $this->assertDatabaseMissing('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund', 'reference_id' => $booking->id,
        ]);
    }

    public function test_expire_negotiate_does_not_clobber_a_booking_a_runner_just_accepted(): void
    {
        Event::fake();
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $booking = $this->makeBooking('wallet', 'paid');
        // Accepted negotiate booking whose window "expired" — must be left alone.
        $booking->update(['status' => 'accepted', 'runner_id' => $runner->id, 'pricing_mode' => 'negotiate']);

        (new \App\Jobs\ExpireNegotiateBookingJob($booking->id))->handle();

        $this->assertEquals('accepted', $booking->fresh()->status);
        $this->assertEquals('paid', $booking->fresh()->payment_status);
        $this->assertDatabaseMissing('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund', 'reference_id' => $booking->id,
        ]);
    }

    public function test_paid_booking_with_no_runner_is_fully_refunded(): void
    {
        Event::fake();
        $booking = $this->makeBooking('wallet', 'paid');

        // No RunnerProfiles exist → matching finds nobody → no_runner.
        MatchRunnerJob::dispatchSync($booking->id);

        $this->assertEquals('no_runner', $booking->fresh()->status);
        $this->assertEquals('refunded', $booking->fresh()->payment_status);
        // Full amount returned (no cancellation fee — the customer was at no fault).
        $this->assertEquals(115.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund', 'reference_id' => $booking->id,
        ]);
        $this->assertDatabaseHas('payments', [
            'booking_id' => $booking->id, 'status' => 'refunded',
        ]);
    }

    public function test_cash_booking_with_no_runner_refunds_nothing(): void
    {
        Event::fake();
        $booking = $this->makeBooking('cash', 'unpaid');

        MatchRunnerJob::dispatchSync($booking->id);

        $this->assertEquals('no_runner', $booking->fresh()->status);
        // Cash collected nothing up front → no refund transaction, balance flat.
        $this->assertDatabaseMissing('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund',
        ]);
        $this->assertEquals(0.0, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_expired_negotiate_booking_refunds_the_paid_offer(): void
    {
        // A negotiate booking is charged the offer up front (H11); if it expires
        // with no runner acceptance, that money must come back.
        Event::fake();
        $booking = $this->makeBooking('wallet', 'paid'); // pending, no runner

        (new \App\Jobs\ExpireNegotiateBookingJob($booking->id))->handle();

        $this->assertEquals('cancelled', $booking->fresh()->status);
        $this->assertEquals('refunded', $booking->fresh()->payment_status);
        $this->assertEquals(115.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund', 'reference_id' => $booking->id,
        ]);
    }

    public function test_refund_unfulfilled_is_idempotent(): void
    {
        $booking = $this->makeBooking('wallet', 'paid');
        $booking->update(['status' => 'no_runner']);

        $svc = app(BookingService::class);
        $svc->refundUnfulfilled($booking->id, 'test');
        $svc->refundUnfulfilled($booking->id, 'test'); // repeat → no-op

        $this->assertEquals(115.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertEquals(
            1,
            WalletTransaction::where('reference_id', $booking->id)->where('type', 'refund')->count(),
        );
    }
}
