<?php

namespace Tests\Feature\Payment;

use App\Http\Resources\BookingResource;
use App\Jobs\AutoCancelBookingJob;
use App\Jobs\ExpireUnpaidBookingJob;
use App\Jobs\MatchRunnerJob;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\Payment;
use App\Models\SystemConfig;
use App\Models\User;
use App\Services\BookingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Money before work: a GCash/Maya errand is never offered to a runner before
 * its payment is confirmed.
 *
 * It used to be matched inside the booking request, before the customer had
 * even opened GCash — so a customer who abandoned the payment could still have
 * a runner do the whole errand for nothing. Now it waits in 'pending', matching
 * starts exactly once from whichever path confirms the payment first (webhook,
 * the app's status check, the reconcile sweep), and an errand still unpaid 15
 * minutes after booking is cancelled with no runner ever involved.
 */
class PaymentBeforeMatchingTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $delivery;
    private string $gatewayStatus = 'PENDING';

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        SystemConfig::setValue('auto_cancel_timeout_minutes', '30');
        config([
            'services.xendit.secret_key' => 'test-secret',
            'services.xendit.webhook_token' => 'test-webhook-token',
        ]);

        $this->customer = User::factory()->create([
            'role' => 'customer', 'status' => 'active', 'wallet_balance' => 0,
        ]);

        $this->delivery = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Send packages',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'surcharge' => 0.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        Http::preventStrayRequests();
        Http::fake([
            'api.xendit.co/payment_requests' => Http::response([
                'id' => 'pr_mbw', 'status' => 'PENDING',
                'actions' => [['url' => 'https://gcash.example/authorize/pr_mbw']],
            ], 200),
            'api.xendit.co/payment_requests/*' => fn () => Http::response([
                'id' => 'pr_mbw', 'status' => $this->gatewayStatus, 'amount' => $this->charged(),
            ], 200),
        ]);

        Bus::fake([MatchRunnerJob::class, AutoCancelBookingJob::class, ExpireUnpaidBookingJob::class]);
    }

    private function charged(): float
    {
        return (float) (Payment::where('gateway_tx_id', 'pr_mbw')->value('amount') ?? 0);
    }

    private function book(string $method, array $extra = []): Booking
    {
        $this->actingAs($this->customer)
            ->postJson('/api/v1/bookings', array_merge([
                'errand_type_id' => $this->delivery->id,
                'pickup_address' => '123 Main St, Manila', 'pickup_lat' => 14.5995, 'pickup_lng' => 120.9842,
                'dropoff_address' => '456 Oak Ave, Makati', 'dropoff_lat' => 14.5547, 'dropoff_lng' => 121.0244,
                'description' => 'Pick up a package', 'schedule_type' => 'now',
                'vehicle_type_rate' => 'motorcycle', 'payment_method' => $method,
            ], $extra))
            ->assertCreated();

        return Booking::latest('created_at')->firstOrFail();
    }

    private function webhook(string $event, array $data, string $deliveryId): void
    {
        $this->postJson('/api/v1/webhooks/xendit', ['event' => $event, 'data' => $data], [
            'x-callback-token' => 'test-webhook-token',
            'webhook-id' => $deliveryId,
        ])->assertOk();
    }

    private function paySucceeded(string $deliveryId = 'whk-1'): void
    {
        $this->webhook('payment.succeeded', [
            'id' => 'py_mbw', 'payment_request_id' => 'pr_mbw', 'status' => 'SUCCEEDED', 'amount' => $this->charged(),
        ], $deliveryId);
    }

    // ── Booking creation ─────────────────────────────────────────────────

    public function test_a_gcash_booking_waits_for_its_payment_instead_of_matching(): void
    {
        $response = $this->actingAs($this->customer)->postJson('/api/v1/bookings', [
            'errand_type_id' => $this->delivery->id,
            'pickup_address' => '123 Main St, Manila', 'pickup_lat' => 14.5995, 'pickup_lng' => 120.9842,
            'dropoff_address' => '456 Oak Ave, Makati', 'dropoff_lat' => 14.5547, 'dropoff_lng' => 121.0244,
            'schedule_type' => 'now', 'payment_method' => 'gcash',
        ]);

        $response->assertCreated()
            ->assertJsonPath('checkout_url', 'https://gcash.example/authorize/pr_mbw')
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.awaiting_payment', true)
            ->assertJsonPath('data.checkout_url', 'https://gcash.example/authorize/pr_mbw');

        $booking = Booking::firstOrFail();
        $this->assertSame('pending', $booking->payment_status);
        $this->assertNull($booking->matching_started_at);
        $this->assertNull($booking->runner_id);

        Bus::assertNotDispatched(MatchRunnerJob::class);
        Bus::assertNotDispatched(AutoCancelBookingJob::class);
        Bus::assertDispatched(ExpireUnpaidBookingJob::class, fn (ExpireUnpaidBookingJob $job) => $job->bookingId === $booking->id
            && $job->delay !== null
            && abs($job->delay->diffInSeconds(now()->addMinutes(BookingService::PAYMENT_WINDOW_MINUTES))) < 5);
    }

    public function test_a_wallet_booking_still_matches_at_once(): void
    {
        $this->customer->update(['wallet_balance' => 5000]);

        $booking = $this->book('wallet');

        $this->assertSame('paid', $booking->payment_status);
        $this->assertNotNull($booking->matching_started_at);
        Bus::assertDispatchedSyncTimes(MatchRunnerJob::class, 1);
        Bus::assertDispatchedTimes(AutoCancelBookingJob::class, 1);
        Bus::assertNotDispatched(ExpireUnpaidBookingJob::class);
        $this->assertFalse(BookingService::awaitingPayment($booking));
    }

    public function test_a_cash_booking_still_matches_at_once(): void
    {
        $booking = $this->book('cash');

        $this->assertSame('unpaid', $booking->payment_status);
        $this->assertNotNull($booking->matching_started_at);
        Bus::assertDispatchedSyncTimes(MatchRunnerJob::class, 1);
        Bus::assertDispatchedTimes(AutoCancelBookingJob::class, 1);
        Bus::assertNotDispatched(ExpireUnpaidBookingJob::class);
        $this->assertFalse(BookingService::awaitingPayment($booking));
    }

    // ── Each confirmation path starts matching exactly once ──────────────

    public function test_the_webhook_starts_matching_once(): void
    {
        $booking = $this->book('gcash');

        $this->paySucceeded('whk-1');
        // A redelivery under a new delivery id gets past the replay guard.
        $this->paySucceeded('whk-2');

        $booking->refresh();
        $this->assertSame('paid', $booking->payment_status);
        $this->assertNotNull($booking->matching_started_at);
        Bus::assertDispatchedSyncTimes(MatchRunnerJob::class, 1);
        Bus::assertDispatchedTimes(AutoCancelBookingJob::class, 1);
    }

    public function test_the_in_app_status_check_starts_matching_once(): void
    {
        $booking = $this->book('maya');
        $payment = Payment::where('booking_id', $booking->id)->firstOrFail();
        $this->gatewayStatus = 'SUCCEEDED';

        $this->getJson("/api/v1/payments/{$payment->id}/status")->assertOk()->assertJsonPath('data.status', 'completed');
        Cache::flush(); // past the per-payment pull throttle
        $this->getJson("/api/v1/payments/{$payment->id}/status")->assertOk();
        $this->getJson("/api/v1/bookings/{$booking->id}/payment-status")->assertOk();

        $this->assertNotNull($booking->fresh()->matching_started_at);
        Bus::assertDispatchedSyncTimes(MatchRunnerJob::class, 1);
        Bus::assertDispatchedTimes(AutoCancelBookingJob::class, 1);
    }

    public function test_the_reconcile_sweep_starts_matching_once(): void
    {
        $booking = $this->book('gcash');
        $this->gatewayStatus = 'SUCCEEDED';
        $this->travel(6)->minutes();

        $this->artisan('errandguy:reconcile-booking-payments')->assertExitCode(0);
        $this->artisan('errandguy:reconcile-booking-payments')->assertExitCode(0);

        $booking->refresh();
        $this->assertSame('paid', $booking->payment_status);
        $this->assertNotNull($booking->matching_started_at);
        Bus::assertDispatchedSyncTimes(MatchRunnerJob::class, 1);
    }

    public function test_every_path_confirming_the_same_payment_still_starts_matching_once(): void
    {
        $booking = $this->book('gcash');
        $payment = Payment::where('booking_id', $booking->id)->firstOrFail();
        $this->gatewayStatus = 'SUCCEEDED';

        $this->paySucceeded('whk-1');
        $this->getJson("/api/v1/payments/{$payment->id}/status")->assertOk();
        $this->travel(6)->minutes();
        $this->artisan('errandguy:reconcile-booking-payments')->assertExitCode(0);
        $this->paySucceeded('whk-2');

        Bus::assertDispatchedSyncTimes(MatchRunnerJob::class, 1);
        Bus::assertDispatchedTimes(AutoCancelBookingJob::class, 1);
    }

    public function test_the_guarded_entry_point_claims_the_errand_once(): void
    {
        $booking = $this->book('gcash');
        $booking->update(['payment_status' => 'paid']);
        $service = app(BookingService::class);

        $this->assertTrue($service->startMatchingAfterPayment($booking->id));
        $this->assertFalse($service->startMatchingAfterPayment($booking->id));

        Bus::assertDispatchedSyncTimes(MatchRunnerJob::class, 1);
    }

    public function test_the_entry_point_never_starts_an_unpaid_or_cancelled_errand(): void
    {
        $booking = $this->book('gcash');
        $service = app(BookingService::class);

        $this->assertFalse($service->startMatchingAfterPayment($booking->id), 'unpaid');

        $booking->update(['payment_status' => 'paid', 'status' => 'cancelled']);
        $this->assertFalse($service->startMatchingAfterPayment($booking->id), 'cancelled');

        Bus::assertNotDispatched(MatchRunnerJob::class);
    }

    public function test_a_paid_errand_whose_start_was_lost_is_started_by_the_sweep(): void
    {
        // The confirming path recorded the payment, then died before matching.
        $booking = $this->book('gcash');
        $payment = Payment::where('booking_id', $booking->id)->firstOrFail();
        $payment->transitionTo(\App\Enums\PaymentStatus::Completed, extra: ['paid_at' => now()]);
        $booking->update(['payment_status' => 'paid']);
        $this->travel(6)->minutes();

        $this->artisan('errandguy:reconcile-booking-payments')->assertExitCode(0);

        $this->assertNotNull($booking->fresh()->matching_started_at);
        Bus::assertDispatchedSyncTimes(MatchRunnerJob::class, 1);
    }

    // ── Nothing else ever matches an unpaid GCash/Maya errand ────────────

    public function test_matching_refuses_an_errand_whose_payment_has_not_arrived(): void
    {
        $booking = $this->book('gcash');

        (new MatchRunnerJob($booking->id))->handle(app(\App\Services\MatchingService::class));

        $booking->refresh();
        $this->assertSame('pending', $booking->status);
        $this->assertNull($booking->matching_started_at);
        Bus::assertNotDispatched(MatchRunnerJob::class); // no re-sweep queued either
    }

    public function test_try_again_is_refused_while_the_payment_is_outstanding(): void
    {
        $booking = $this->book('gcash');

        $this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$booking->id}")
            ->assertJsonPath('data.can_retry_match', false);

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/retry-match")
            ->assertStatus(409)
            ->assertJsonPath('message', 'This errand hasn’t been paid for yet. We start looking for a runner as soon as your GCash/Maya payment is confirmed.');

        Bus::assertNotDispatched(MatchRunnerJob::class);
        $this->assertNull($booking->fresh()->matching_started_at);
    }

    // ── An abandoned payment ─────────────────────────────────────────────

    public function test_an_unpaid_errand_is_cancelled_quietly_after_the_payment_window(): void
    {
        $booking = $this->book('gcash');
        $this->travel(BookingService::PAYMENT_WINDOW_MINUTES + 1)->minutes();

        $this->assertTrue(app()->call([new ExpireUnpaidBookingJob($booking->id), 'handle']));

        $booking->refresh();
        $this->assertSame('cancelled', $booking->status);
        $this->assertSame("Payment wasn't completed, so your errand was cancelled.", $booking->cancellation_reason);
        $this->assertNull($booking->runner_id);
        $this->assertSame(0.0, (float) $this->customer->fresh()->wallet_balance, 'nothing was taken, nothing to refund');
        Bus::assertNotDispatched(MatchRunnerJob::class);

        // Xendit was asked first, and the charge itself stays open.
        Http::assertSent(fn ($request) => $request->method() === 'GET' && str_contains($request->url(), '/payment_requests/pr_mbw'));
        $this->assertSame('processing', Payment::where('booking_id', $booking->id)->value('status'));

        $this->assertDatabaseHas('notifications', [
            'user_id' => $this->customer->id,
            'title' => 'Errand cancelled',
            'body' => "Payment wasn't completed, so your errand #{$booking->booking_number} was cancelled.",
        ]);

        $this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$booking->id}")
            ->assertJsonPath('data.awaiting_payment', false)
            ->assertJsonPath('data.checkout_url', null)
            ->assertJsonPath('data.cancellation_code', 'payment_not_completed')
            ->assertJsonPath('data.cancellation_reason', "Payment wasn't completed, so your errand was cancelled.");

        // The live status broadcast carries the code too.
        $this->assertSame(
            'payment_not_completed',
            (new \App\Events\BookingCancelled($booking))->broadcastWith()['cancellation_code'],
        );
    }

    public function test_other_cancellations_carry_no_cancellation_code(): void
    {
        $booking = $this->book('cash');

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/cancel", ['reason' => 'Changed my mind'])
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.cancellation_code', null);
    }

    public function test_the_cancellation_code_migration_is_rerunnable(): void
    {
        $migration = require database_path('migrations/2026_10_31_000006_add_cancellation_code_to_bookings.php');

        $migration->up(); // already applied: a no-op
        $this->assertTrue(\Illuminate\Support\Facades\Schema::hasColumn('bookings', 'cancellation_code'));

        $migration->down();
        $migration->down();
        $this->assertFalse(\Illuminate\Support\Facades\Schema::hasColumn('bookings', 'cancellation_code'));

        $migration->up();
        $this->assertTrue(\Illuminate\Support\Facades\Schema::hasColumn('bookings', 'cancellation_code'));
    }

    public function test_the_payment_window_is_not_cut_short(): void
    {
        $booking = $this->book('gcash');
        $this->travel(BookingService::PAYMENT_WINDOW_MINUTES - 2)->minutes();

        $this->assertFalse(app()->call([new ExpireUnpaidBookingJob($booking->id), 'handle']));

        $this->assertSame('pending', $booking->fresh()->status);
        // Re-armed for the rest of the window.
        Bus::assertDispatched(ExpireUnpaidBookingJob::class, fn (ExpireUnpaidBookingJob $job) => $job->bookingId === $booking->id
            && $job->delay !== null && $job->delay->isFuture());
    }

    public function test_a_payment_that_landed_without_its_webhook_is_matched_not_cancelled(): void
    {
        $booking = $this->book('gcash');
        $this->gatewayStatus = 'SUCCEEDED';
        $this->travel(BookingService::PAYMENT_WINDOW_MINUTES + 1)->minutes();

        $this->assertFalse(app()->call([new ExpireUnpaidBookingJob($booking->id), 'handle']));

        $booking->refresh();
        $this->assertSame('pending', $booking->status);
        $this->assertSame('paid', $booking->payment_status);
        $this->assertNotNull($booking->matching_started_at);
        Bus::assertDispatchedSyncTimes(MatchRunnerJob::class, 1);
    }

    public function test_a_declined_payment_cancels_the_waiting_errand_with_the_same_reason(): void
    {
        $booking = $this->book('gcash');

        $this->webhook('payment.failed', ['payment_request_id' => 'pr_mbw', 'failure_code' => 'USER_DECLINED'], 'whk-f');

        $booking->refresh();
        $this->assertSame('cancelled', $booking->status);
        $this->assertSame(BookingService::PAYMENT_NOT_COMPLETED, $booking->cancellation_reason);
        $this->assertSame('payment_not_completed', $booking->cancellation_code);
        Bus::assertNotDispatched(MatchRunnerJob::class);
    }

    public function test_a_payment_after_the_abandon_cancel_is_refunded_to_the_wallet_with_no_runner(): void
    {
        $booking = $this->book('gcash');
        $this->travel(BookingService::PAYMENT_WINDOW_MINUTES + 1)->minutes();
        app()->call([new ExpireUnpaidBookingJob($booking->id), 'handle']);
        $this->assertSame('cancelled', $booking->fresh()->status);

        // The customer approves the old charge in GCash anyway.
        $this->paySucceeded('whk-late');

        $booking->refresh();
        $total = (float) $booking->total_amount;
        $this->assertSame('cancelled', $booking->status);
        $this->assertNull($booking->runner_id);
        $this->assertSame('refunded', $booking->payment_status);
        $this->assertEquals($total, (float) $this->customer->fresh()->wallet_balance);
        $this->assertDatabaseHas('payments', ['booking_id' => $booking->id, 'status' => 'refunded', 'refunded_to' => 'wallet']);
        Bus::assertNotDispatched(MatchRunnerJob::class);

        $this->assertDatabaseHas('notifications', ['user_id' => $this->customer->id, 'title' => 'Refund issued']);

        // A redelivery refunds nothing more.
        $this->paySucceeded('whk-late-2');
        $this->assertEquals($total, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_the_reaper_cancels_an_unpaid_errand_whose_delayed_job_was_lost(): void
    {
        $booking = $this->book('gcash');
        $this->travel(BookingService::PAYMENT_WINDOW_MINUTES + 5)->minutes();

        $this->artisan('errandguy:reap-stranded-bookings')->assertExitCode(0);

        $booking->refresh();
        $this->assertSame('cancelled', $booking->status);
        $this->assertSame(BookingService::PAYMENT_NOT_COMPLETED, $booking->cancellation_reason);
    }

    public function test_the_no_runner_auto_cancel_leaves_a_waiting_errand_to_its_payment_window(): void
    {
        $booking = $this->book('gcash');
        $this->travel(40)->minutes();

        $this->assertFalse((new AutoCancelBookingJob($booking->id))->handle());
        $this->assertSame('pending', $booking->fresh()->status);
    }

    // ── The search window counts from matching start ─────────────────────

    public function test_the_auto_cancel_counts_from_when_matching_started(): void
    {
        $this->customer->update(['wallet_balance' => 5000]);
        $booking = $this->book('wallet');

        // Booked 40 minutes ago, but its search only started 5 minutes ago.
        $booking->forceFill(['created_at' => now()->subMinutes(40), 'matching_started_at' => now()->subMinutes(5)])->save();
        $this->assertFalse((new AutoCancelBookingJob($booking->id))->handle());
        $this->assertSame('pending', $booking->fresh()->status);

        $this->artisan('errandguy:reap-stranded-bookings')->assertExitCode(0);
        $this->assertSame('pending', $booking->fresh()->status, 'the reaper counts from matching start too');

        // 31 minutes of searching: time is up, and the paid fare goes back.
        $booking->forceFill(['matching_started_at' => now()->subMinutes(31)])->save();
        $this->assertTrue((new AutoCancelBookingJob($booking->id))->handle());
        $this->assertSame('cancelled', $booking->fresh()->status);
        $this->assertEquals(5000, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_a_paid_errand_gets_its_full_search_window_after_a_slow_payment(): void
    {
        $booking = $this->book('gcash');
        $this->travel(12)->minutes();
        $this->paySucceeded();

        $booking->refresh();
        $deadline = BookingService::matchingDeadline($booking);
        $this->assertTrue($deadline->equalTo($booking->matching_started_at->copy()->addMinutes(30)));
        Bus::assertDispatched(AutoCancelBookingJob::class, fn (AutoCancelBookingJob $job) => $job->delay !== null
            && abs($job->delay->diffInSeconds(now()->addMinutes(30))) < 5);
    }

    // ── Scheduled errands ────────────────────────────────────────────────

    public function test_a_paid_scheduled_errand_is_left_for_the_scheduled_sweep_at_its_time(): void
    {
        $scheduledAt = now()->addHours(2)->startOfMinute();
        $booking = $this->book('gcash', ['schedule_type' => 'scheduled', 'scheduled_at' => $scheduledAt->toIso8601String()]);

        $this->paySucceeded();

        $booking->refresh();
        $this->assertSame('paid', $booking->payment_status);
        $this->assertNull($booking->matching_started_at, 'not before its window opens');
        Bus::assertNotDispatched(MatchRunnerJob::class);

        // The window opens 15 minutes before its time; no grace for a paid
        // GCash/Maya errand (nothing else was queued to start it).
        $this->travelTo($scheduledAt->copy()->subMinutes(BookingService::SCHEDULED_MATCH_LEAD_MINUTES));
        $this->artisan('errandguy:start-due-scheduled-matching')->assertExitCode(0);
        $this->artisan('errandguy:start-due-scheduled-matching')->assertExitCode(0);

        $this->assertNotNull($booking->fresh()->matching_started_at);
        Bus::assertDispatchedSyncTimes(MatchRunnerJob::class, 1);
        Bus::assertDispatched(AutoCancelBookingJob::class, fn (AutoCancelBookingJob $job) => $job->bookingId === $booking->id);
    }

    public function test_the_scheduled_sweep_never_starts_an_unpaid_gcash_errand(): void
    {
        $booking = Booking::create([
            'booking_number' => 'EG-20261031-SCHUNP',
            'customer_id' => $this->customer->id, 'errand_type_id' => $this->delivery->id,
            'status' => 'pending', 'payment_method' => 'gcash', 'payment_status' => 'pending',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'scheduled', 'scheduled_at' => now()->addMinutes(10),
            'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false,
        ]);

        $this->artisan('errandguy:start-due-scheduled-matching')->assertExitCode(0);

        $this->assertNull($booking->fresh()->matching_started_at);
        Bus::assertNotDispatched(MatchRunnerJob::class);
    }

    // ── Resuming the payment ─────────────────────────────────────────────

    public function test_only_the_customer_sees_the_checkout_url_and_only_while_awaiting_payment(): void
    {
        $booking = $this->book('gcash');

        $this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$booking->id}")
            ->assertJsonPath('data.awaiting_payment', true)
            ->assertJsonPath('data.checkout_url', 'https://gcash.example/authorize/pr_mbw');

        $stranger = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $request = Request::create('/');
        $request->setUserResolver(fn () => $stranger);
        $this->actingAs($stranger);
        $asStranger = (new BookingResource($booking->fresh()))->toArray($request);
        $this->assertTrue($asStranger['awaiting_payment']);
        $this->assertNull($asStranger['checkout_url']);

        $this->paySucceeded();

        $this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$booking->id}")
            ->assertJsonPath('data.awaiting_payment', false)
            ->assertJsonPath('data.checkout_url', null);
    }
}
