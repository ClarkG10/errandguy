<?php

namespace Tests\Feature\Booking;

use App\Jobs\AutoCancelBookingJob;
use App\Jobs\MatchRunnerJob;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Tests\TestCase;

/**
 * BOOK-1 regression: retry-match must never revive a booking whose money was
 * already returned (refunded on cancel/auto-cancel) or never collected for a
 * non-cash charge — otherwise the errand runs for free (customer refunded, yet
 * a runner is paid by the platform on completion). Cash bookings hold no
 * upfront money, so they may still retry.
 */
class RetryMatchRefundGuardTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        // The guard under test runs BEFORE matching is dispatched; fake the
        // downstream jobs so an allowed retry doesn't run real matching /
        // broadcasting (which blocks in the test env).
        Bus::fake([MatchRunnerJob::class, AutoCancelBookingJob::class]);
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50.00, 'per_km_walk' => 15.00, 'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00,
            'per_km_car' => 18.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeBooking(string $status, string $method, ?string $paymentStatus): Booking
    {
        return Booking::create([
            'booking_number' => 'EG-20260808-'.strtoupper(substr(md5($status.$method.$paymentStatus), 0, 4)),
            'customer_id' => $this->customer->id, 'errand_type_id' => $this->errandType->id, 'status' => $status,
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 100,
            'payment_method' => $method, 'payment_status' => $paymentStatus, 'is_transportation' => false,
            // The retryMatch policy only permits reviving a `cancelled` row whose
            // cancellation was the auto-cancel safety net — the exact BOOK-1
            // scenario (auto-cancel refunds AND sets this reason).
            'cancellation_reason' => $status === 'cancelled' ? 'Auto-cancelled: no runner found within timeout.' : null,
        ]);
    }

    public function test_refunded_cancelled_booking_cannot_be_retried(): void
    {
        $booking = $this->makeBooking('cancelled', 'gcash', 'refunded');

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/retry-match")
            ->assertStatus(409)
            ->assertJsonPath('code', 'RETRY_NOT_ALLOWED')
            ->assertJsonPath('data.reason', 'refunded')
            ->assertJsonPath('message', 'This booking was already refunded, so it can’t be retried. Please create a new booking to try again.');

        // Untouched — still cancelled, not reopened, and no matching kicked off.
        $this->assertEquals('cancelled', $booking->fresh()->status);
        Bus::assertNotDispatched(MatchRunnerJob::class);
    }

    public function test_failed_online_booking_cannot_be_retried(): void
    {
        $booking = $this->makeBooking('no_runner', 'gcash', 'failed');

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/retry-match")
            ->assertStatus(409)
            ->assertJsonPath('code', 'RETRY_NOT_ALLOWED')
            ->assertJsonPath('data.reason', 'refunded');

        $this->assertEquals('no_runner', $booking->fresh()->status);
        Bus::assertNotDispatched(MatchRunnerJob::class);
    }

    public function test_paid_booking_can_still_be_retried(): void
    {
        // Money is still held → retry is legitimate; it resets to pending and
        // kicks off a fresh match.
        $booking = $this->makeBooking('no_runner', 'gcash', 'paid');

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/retry-match")
            ->assertOk();

        $this->assertEquals('pending', $booking->fresh()->status);
        Bus::assertDispatched(MatchRunnerJob::class);
    }

    public function test_a_scheduled_errand_not_yet_open_is_refused_with_its_reason(): void
    {
        $later = $this->makeBooking('pending', 'cash', 'unpaid');
        $later->update(['schedule_type' => 'scheduled', 'scheduled_at' => now()->addHours(3)]);

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$later->id}/retry-match")
            ->assertStatus(409)
            ->assertJsonPath('code', 'RETRY_NOT_ALLOWED')
            ->assertJsonPath('data.reason', 'scheduled')
            ->assertJsonPath('message', 'This errand is scheduled for later. We’ll start looking for a runner 15 minutes before its time.');

        Bus::assertNotDispatched(MatchRunnerJob::class);
    }

    public function test_a_retry_long_after_booking_starts_a_full_new_search_window(): void
    {
        $booking = $this->makeBooking('no_runner', 'cash', 'unpaid');
        $booking->update(['matching_started_at' => now()->subHours(2), 'offer_count' => 5, 'offered_runner_ids' => ['someone']]);
        $booking->forceFill(['created_at' => now()->subHours(2)])->save();

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/retry-match")
            ->assertOk();

        $fresh = $booking->fresh();
        $this->assertSame(0, $fresh->offer_count);
        $this->assertNull($fresh->offered_runner_ids);
        $deadline = \App\Services\BookingService::matchingDeadline($fresh);
        $this->assertTrue($deadline->between(now()->addMinutes(29), now()->addMinutes(31)));
        Bus::assertDispatched(AutoCancelBookingJob::class, fn (AutoCancelBookingJob $job) => $job->bookingId === $booking->id
            && \Illuminate\Support\Carbon::parse($job->delay)->equalTo($deadline));

        // The old window is long gone, but neither the auto-cancel nor the
        // reaper ends the new search early.
        $this->assertFalse((new AutoCancelBookingJob($booking->id))->handle());
        $this->artisan('errandguy:reap-stranded-bookings')->assertSuccessful();
        $this->assertSame('pending', $booking->fresh()->status);
    }

    public function test_a_retry_of_a_scheduled_errand_whose_window_closed_runs_like_one_booked_for_now(): void
    {
        $booking = $this->makeBooking('no_runner', 'cash', 'unpaid');
        $booking->update(['schedule_type' => 'scheduled', 'scheduled_at' => now()->subHour(), 'matching_started_at' => now()->subMinutes(75)]);

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/retry-match")
            ->assertOk();

        $fresh = $booking->fresh();
        $this->assertSame('now', $fresh->schedule_type);
        $this->assertTrue(\App\Services\BookingService::matchingDeadline($fresh)->greaterThan(now()->addMinutes(29)));
        $this->assertFalse((new AutoCancelBookingJob($booking->id))->handle());
        $this->assertSame('pending', $booking->fresh()->status);
    }

    public function test_cash_booking_can_still_be_retried(): void
    {
        // Cash holds no upfront money → nothing to lose on a re-match.
        $booking = $this->makeBooking('no_runner', 'cash', 'unpaid');

        $this->actingAs($this->customer)
            ->postJson("/api/v1/bookings/{$booking->id}/retry-match")
            ->assertOk();

        $this->assertEquals('pending', $booking->fresh()->status);
        Bus::assertDispatched(MatchRunnerJob::class);
    }
}
