<?php

namespace Tests\Feature\Payment;

use App\Jobs\AutoCancelBookingJob;
use App\Jobs\MatchRunnerJob;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * A paid errand whose search was claimed (matching_started_at committed) but
 * whose process died before it armed the auto-cancel and ran the first sweep.
 * Every other backstop wants matching_started_at NULL, so nothing searched for
 * it and the customer waited out the whole window for a refund. The 15-minute
 * reconcile sweep now resumes it — and leaves alone every errand whose search
 * is alive, scheduled, or already out of time.
 */
class ResumeStalledSearchTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    private ErrandType $type;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        \App\Models\SystemConfig::setValue('auto_cancel_timeout_minutes', '30');
        Bus::fake([MatchRunnerJob::class, AutoCancelBookingJob::class]);

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function claimedSearch(array $overrides = []): Booking
    {
        $booking = Booking::create(array_merge([
            'booking_number' => 'EG-RS-'.substr(uniqid(), -8),
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->type->id,
            'status' => 'pending',
            'payment_method' => 'wallet',
            'payment_status' => 'paid',
            'offer_count' => 0,
            'matching_started_at' => now()->subMinutes(10),
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ], $overrides));

        // The row was last written when its search was claimed (or as given).
        $booking->timestamps = false;
        $booking->forceFill(['updated_at' => $overrides['updated_at'] ?? $booking->matching_started_at ?? now()])->save();
        $booking->timestamps = true;

        return $booking;
    }

    public function test_a_paid_errand_whose_search_never_ran_is_resumed(): void
    {
        $booking = $this->claimedSearch();

        $this->artisan('errandguy:reconcile-booking-payments')->assertSuccessful();

        Bus::assertDispatchedSyncTimes(MatchRunnerJob::class, 1);
        Bus::assertDispatchedSync(MatchRunnerJob::class, fn (MatchRunnerJob $job) => $job->bookingId === $booking->id);
        Bus::assertDispatched(AutoCancelBookingJob::class, fn (AutoCancelBookingJob $job) => $job->bookingId === $booking->id);
        // Its search window still counts from when it was first claimed.
        $this->assertEquals(
            $booking->matching_started_at->toIso8601String(),
            $booking->fresh()->matching_started_at->toIso8601String(),
        );
    }

    public function test_a_gcash_errand_paid_and_stranded_the_same_way_is_resumed(): void
    {
        $this->claimedSearch(['payment_method' => 'gcash']);

        $this->artisan('errandguy:reconcile-booking-payments')->assertSuccessful();

        Bus::assertDispatchedSyncTimes(MatchRunnerJob::class, 1);
    }

    public function test_a_slow_ladder_staff_configured_is_not_restarted_mid_search(): void
    {
        // Three sweeps ten minutes apart: a search 10 minutes in with no offer
        // yet is still running, and must not get a second sweep chain.
        \App\Models\SystemConfig::updateOrCreate(['key' => 'matching_retry_delay_seconds'], ['value' => '600']);
        $booking = $this->claimedSearch(['matching_started_at' => now()->subMinutes(10)]);

        $this->artisan('errandguy:reconcile-booking-payments')->assertSuccessful();

        Bus::assertNotDispatched(\App\Jobs\MatchRunnerJob::class);
        $this->assertSame(0, (int) $booking->fresh()->offer_count);
    }

    public function test_errands_whose_search_is_alive_or_over_are_left_alone(): void
    {
        // Just claimed: its first sweep may still be running.
        $this->claimedSearch(['matching_started_at' => now()->subMinute()]);
        // Offered a moment ago (an offer or reset writes the row): its
        // search is running.
        $this->claimedSearch(['offer_count' => 1, 'updated_at' => now()->subMinute()]);
        // Not paid: no search runs before the money is in.
        $this->claimedSearch(['payment_method' => 'gcash', 'payment_status' => 'pending']);
        // Out of time: the stranded-booking reaper cancels and refunds it.
        $this->claimedSearch(['matching_started_at' => now()->subMinutes(45)]);
        // Scheduled: re-sweeps with no offers until its window closes.
        $this->claimedSearch([
            'schedule_type' => 'scheduled',
            'scheduled_at' => now()->addMinutes(5),
        ]);
        // Matched / taken.
        $this->claimedSearch(['status' => 'matched']);

        $this->artisan('errandguy:reconcile-booking-payments')->assertSuccessful();

        Bus::assertNotDispatched(MatchRunnerJob::class);
        Bus::assertNotDispatchedSync(MatchRunnerJob::class);
        Bus::assertNotDispatched(AutoCancelBookingJob::class);
    }

    public function test_a_search_that_stopped_after_an_offer_is_resumed_and_so_is_a_cash_one(): void
    {
        // The offer lapsed (or was declined), the errand went back to pending
        // and its next search was queued — and lost. Nothing has written the
        // row since, so nothing is searching. It was outside the sweep, as was
        // every cash errand, until the auto-cancel ~30 minutes later.
        $offered = $this->claimedSearch(['offer_count' => 2, 'updated_at' => now()->subMinutes(8)]);
        $cash = $this->claimedSearch(['payment_method' => 'cash', 'payment_status' => 'unpaid', 'updated_at' => now()->subMinutes(8)]);

        $this->artisan('errandguy:reconcile-booking-payments')->assertSuccessful();

        Bus::assertDispatchedSyncTimes(MatchRunnerJob::class, 2);
        foreach ([$offered, $cash] as $booking) {
            Bus::assertDispatchedSync(MatchRunnerJob::class, fn (MatchRunnerJob $job) => $job->bookingId === $booking->id);
        }
    }

    public function test_a_search_that_failed_for_good_raises_an_alert_naming_the_errand(): void
    {
        $booking = $this->claimedSearch();

        (new MatchRunnerJob($booking->id))->failed(new \RuntimeException('Deadlock found when trying to get lock'));

        $alert = \App\Models\AdminAlert::where('type', 'matching_failed')->sole();
        $this->assertSame($booking->id, $alert->subject_id);
        $this->assertStringContainsString($booking->booking_number, $alert->title);
    }
}
