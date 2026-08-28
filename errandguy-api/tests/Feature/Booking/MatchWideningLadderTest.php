<?php

namespace Tests\Feature\Booking;

use App\Jobs\MatchRunnerJob;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\SystemConfig;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Tests\TestCase;

/**
 * A single empty radius sweep is a snapshot, not a verdict — runners come
 * online, finish a job, or drive into range within a minute. Matching used to
 * declare `no_runner` (and auto-refund) on the first miss, seconds after the
 * customer paid, leaving them to notice and rebook by hand.
 *
 * These guard the automatic widening ladder: stay `pending` and re-sweep at a
 * wider radius, and only give up when the attempts are spent or the booking's
 * auto-cancel deadline is about to pass.
 */
class MatchWideningLadderTest extends TestCase
{
    use RefreshDatabase;

    private function makeBooking(array $overrides = []): Booking
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'D',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30,
            'is_active' => true, 'sort_order' => 1,
        ]);

        return Booking::create(array_merge([
            'booking_number' => 'EG-L-'.uniqid(),
            'customer_id' => $customer->id,
            'errand_type_id' => $type->id,
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
            'status' => 'pending',
        ], $overrides));
    }

    /**
     * No runners online at all, so every sweep comes back empty. The first one
     * must NOT terminate the booking.
     */
    public function test_first_empty_sweep_keeps_booking_pending_and_requeues_wider(): void
    {
        Bus::fake([MatchRunnerJob::class]);
        $booking = $this->makeBooking();

        (new MatchRunnerJob($booking->id))->handle(app(\App\Services\MatchingService::class));

        $booking->refresh();
        $this->assertSame('pending', $booking->status, 'first empty sweep must not bury the booking');

        Bus::assertDispatched(MatchRunnerJob::class, function (MatchRunnerJob $job) use ($booking) {
            // Second rung: 1.75 × the 10km default.
            return $job->bookingId === $booking->id
                && $job->attempt === 2
                && (float) $job->radiusOverrideKm === 17.5;
        });
    }

    /**
     * Last rung of the ladder: give up honestly so the customer gets their
     * "no runner found" message (and their refund) instead of waiting silently.
     */
    public function test_final_attempt_declares_no_runner(): void
    {
        Bus::fake([MatchRunnerJob::class]);
        $booking = $this->makeBooking();

        (new MatchRunnerJob($booking->id, 25.0, null, 3))->handle(app(\App\Services\MatchingService::class));

        $booking->refresh();
        $this->assertSame('no_runner', $booking->status);
        Bus::assertNotDispatched(MatchRunnerJob::class);
    }

    /**
     * A re-sweep that would land after AutoCancelBookingJob ends the booking
     * buys the customer nothing but silence — stop the ladder early instead.
     */
    public function test_ladder_stops_when_next_sweep_would_pass_the_auto_cancel_deadline(): void
    {
        Bus::fake([MatchRunnerJob::class]);
        SystemConfig::query()->updateOrCreate(
            ['key' => 'auto_cancel_timeout_minutes'],
            ['value' => '30'],
        );

        // Created 30 minutes ago: the auto-cancel deadline is already here.
        $booking = $this->makeBooking();
        $booking->forceFill(['created_at' => now()->subMinutes(30)])->save();

        (new MatchRunnerJob($booking->id))->handle(app(\App\Services\MatchingService::class));

        $booking->refresh();
        $this->assertSame('no_runner', $booking->status);
        Bus::assertNotDispatched(MatchRunnerJob::class);
    }

    /**
     * A scheduled booking placed days ahead is matched at scheduled_at − 15min
     * and auto-cancelled relative to THAT, not to when it was created. Anchoring
     * the ladder on created_at made every such booking look long expired on its
     * first sweep, so it went straight to no_runner (and refunded a prepaid
     * fare) for exactly the bookings whose matching window is tightest.
     */
    public function test_scheduled_booking_ladder_is_anchored_on_its_window_not_creation(): void
    {
        Bus::fake([MatchRunnerJob::class]);

        $booking = $this->makeBooking([
            'schedule_type' => 'scheduled',
            'scheduled_at' => now()->addMinutes(15),
        ]);
        // Placed four days ago — far outside an auto-cancel window measured
        // from creation, but its actual window is opening right now.
        $booking->forceFill(['created_at' => now()->subDays(4)])->save();

        (new MatchRunnerJob($booking->id))->handle(app(\App\Services\MatchingService::class));

        $booking->refresh();
        $this->assertSame('pending', $booking->status);
        Bus::assertDispatched(
            MatchRunnerJob::class,
            fn (MatchRunnerJob $job) => $job->bookingId === $booking->id && $job->attempt === 2,
        );
    }

    /**
     * The ladder must never resurrect a booking the customer cancelled or a
     * runner already took — the pending pre-check owns that.
     */
    public function test_ladder_does_not_run_for_a_booking_that_left_pending(): void
    {
        Bus::fake([MatchRunnerJob::class]);
        $booking = $this->makeBooking(['status' => 'cancelled']);

        (new MatchRunnerJob($booking->id))->handle(app(\App\Services\MatchingService::class));

        $booking->refresh();
        $this->assertSame('cancelled', $booking->status);
        Bus::assertNotDispatched(MatchRunnerJob::class);
    }
}
