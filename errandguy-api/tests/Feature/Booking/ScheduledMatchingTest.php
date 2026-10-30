<?php

namespace Tests\Feature\Booking;

use App\Jobs\AutoCancelBookingJob;
use App\Jobs\MatchRunnerJob;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\RunnerProfile;
use App\Models\SystemConfig;
use App\Models\User;
use App\Services\MatchingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * A scheduled errand used to get ONE ~90-second search, 15 minutes before its
 * time, started by a single delayed task with no backup. Now it keeps
 * searching (same widening steps) until 15 minutes after its time before
 * ending as "no runner" with a refund, nothing cancels it mid-search, and a
 * sweep starts the search — once — if the delayed task was lost.
 */
class ScheduledMatchingTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $type;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        // The seeded timeout is 5 minutes — shorter than a scheduled errand's
        // search window, which is exactly the case that must still hold.
        SystemConfig::setValue('auto_cancel_timeout_minutes', '5');

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 0]);
        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function scheduled(\DateTimeInterface $at, array $overrides = []): Booking
    {
        $booking = Booking::create(array_merge([
            'booking_number' => 'EG-SCH-'.strtoupper(substr(md5(uniqid('', true)), 0, 6)),
            'customer_id' => $this->customer->id, 'errand_type_id' => $this->type->id,
            'status' => 'pending', 'schedule_type' => 'scheduled', 'scheduled_at' => $at,
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'payment_method' => 'wallet', 'payment_status' => 'paid',
            'is_transportation' => false,
        ], $overrides));
        $booking->forceFill(['created_at' => now()->subDays(2)])->save();

        Payment::create([
            'booking_id' => $booking->id, 'customer_id' => $this->customer->id,
            'amount' => 115, 'method' => 'wallet', 'status' => 'completed', 'paid_at' => now(),
        ]);

        return $booking->fresh();
    }

    private function sweep(): void
    {
        $this->artisan('errandguy:start-due-scheduled-matching')->assertSuccessful();
    }

    public function test_a_scheduled_search_keeps_going_past_the_three_immediate_sweeps(): void
    {
        Bus::fake([MatchRunnerJob::class]);
        $booking = $this->scheduled(now()->addMinutes(5));

        // Sweep 7 finds nobody — an immediate errand would have given up at 3.
        (new MatchRunnerJob($booking->id, 25.0, null, 7))->handle(app(MatchingService::class));

        $this->assertSame('pending', $booking->fresh()->status);
        Bus::assertDispatched(MatchRunnerJob::class, fn (MatchRunnerJob $job) => $job->bookingId === $booking->id
            && $job->attempt === 8
            && (float) $job->radiusOverrideKm === 25.0); // stays on the widest rung
    }

    public function test_a_scheduled_search_ends_as_no_runner_15_minutes_after_the_time(): void
    {
        Bus::fake([MatchRunnerJob::class]);
        Event::fake();
        // 14.5 minutes past its time: the next sweep (45 s) would land past
        // the 15-minute grace.
        $booking = $this->scheduled(now()->subSeconds(870));

        (new MatchRunnerJob($booking->id, 25.0, null, 40))->handle(app(MatchingService::class));

        $fresh = $booking->fresh();
        $this->assertSame('no_runner', $fresh->status);
        $this->assertSame('refunded', $fresh->payment_status);
        $this->assertEquals(115.0, (float) $this->customer->fresh()->wallet_balance);
        Bus::assertNotDispatched(MatchRunnerJob::class);
    }

    public function test_auto_cancel_never_ends_a_scheduled_errand_while_it_is_still_being_searched_for(): void
    {
        Bus::fake([AutoCancelBookingJob::class]);
        Event::fake();
        // Scheduled 10 minutes ago, placed two days ago: by creation time (and
        // the 5-minute timeout) it is long overdue, but its search runs until
        // 15 minutes after the time.
        $booking = $this->scheduled(now()->subMinutes(10));

        $this->assertFalse((new AutoCancelBookingJob($booking->id))->handle());
        $this->assertSame('pending', $booking->fresh()->status);
        Bus::assertDispatched(AutoCancelBookingJob::class);

        $this->travel(6)->minutes();
        $this->assertTrue((new AutoCancelBookingJob($booking->id))->handle());
        $this->assertSame('cancelled', $booking->fresh()->status);
        $this->assertSame('refunded', $booking->fresh()->payment_status);
    }

    public function test_booking_a_scheduled_errand_queues_the_search_and_the_auto_cancel_around_its_time(): void
    {
        Bus::fake();
        $at = now()->addHours(3)->startOfMinute();

        $this->actingAs($this->customer)->postJson('/api/v1/bookings', [
            'errand_type_id' => $this->type->id,
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'scheduled', 'scheduled_at' => $at->toIso8601String(),
            'vehicle_type_rate' => 'motorcycle', 'payment_method' => 'cash',
        ])->assertCreated();

        Bus::assertDispatched(MatchRunnerJob::class, fn (MatchRunnerJob $job) => $job->delay !== null
            && $job->delay->equalTo($at->copy()->subMinutes(15)));
        Bus::assertDispatched(AutoCancelBookingJob::class, fn (AutoCancelBookingJob $job) => $job->delay !== null
            && $job->delay->equalTo($at->copy()->addMinutes(15)));
        Bus::assertNotDispatchedSync(MatchRunnerJob::class);
    }

    public function test_matching_records_when_it_first_started(): void
    {
        Bus::fake([MatchRunnerJob::class]);
        $booking = $this->scheduled(now()->addMinutes(10));
        $this->assertNull($booking->matching_started_at);

        (new MatchRunnerJob($booking->id))->handle(app(MatchingService::class));

        $this->assertNotNull($booking->fresh()->matching_started_at);
    }

    public function test_the_sweep_starts_matching_for_a_due_errand_whose_task_was_lost_exactly_once(): void
    {
        Event::fake();
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'vehicle_type' => 'motorcycle', 'current_lat' => 14.6001, 'current_lng' => 120.98,
            'last_location_at' => now(), 'preferred_types' => [],
        ]);
        // Window opened 5 minutes ago; its delayed task never ran.
        $booking = $this->scheduled(now()->addMinutes(10));

        $this->sweep();

        $fresh = $booking->fresh();
        $this->assertNotNull($fresh->matching_started_at);
        $this->assertSame('matched', $fresh->status);
        $this->assertSame($runner->id, $fresh->runner_id);

        // The runner lets it lapse and it goes back to pending — the sweep must
        // not start a second search of its own: matching is already running.
        $fresh->update(['status' => 'pending', 'runner_id' => null, 'matched_at' => null]);
        Bus::fake([MatchRunnerJob::class]);
        $this->sweep();
        Bus::assertNotDispatched(MatchRunnerJob::class);
        Bus::assertNotDispatchedSync(MatchRunnerJob::class);
    }

    public function test_the_sweep_leaves_alone_what_is_not_due_already_searching_or_over(): void
    {
        Bus::fake([MatchRunnerJob::class]);

        $notDue = $this->scheduled(now()->addHours(3));
        $justOpened = $this->scheduled(now()->addMinutes(14)); // its delayed task is about to run
        $searching = $this->scheduled(now()->addMinutes(5), ['matching_started_at' => now()->subMinutes(5)]);
        $over = $this->scheduled(now()->subMinutes(20));
        $leftoverNegotiate = $this->scheduled(now()->addMinutes(5), ['pricing_mode' => 'negotiate']);
        $refunded = $this->scheduled(now()->addMinutes(5), ['payment_status' => 'refunded']);

        $this->sweep();

        Bus::assertNotDispatchedSync(MatchRunnerJob::class);
        foreach ([$notDue, $justOpened, $over, $leftoverNegotiate, $refunded] as $booking) {
            $this->assertNull($booking->fresh()->matching_started_at, $booking->booking_number);
        }
        $this->assertEquals(
            $searching->matching_started_at->timestamp,
            $searching->fresh()->matching_started_at->timestamp,
        );
    }
}
