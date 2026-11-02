<?php

namespace Tests\Feature\Admin;

use App\Exceptions\BookingStateException;
use App\Filament\Resources\Bookings\Pages\ListBookings;
use App\Jobs\AutoCancelBookingJob;
use App\Jobs\MatchRunnerJob;
use App\Models\AdminAlert;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\BookingStop;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\Payment;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\BookingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Spatie\Activitylog\Models\Activity;
use Tests\TestCase;

/**
 * Staff tools for errands that are stuck:
 *
 *   - "Re-run matching" (no runner yet) refuses an errand whose money already
 *     went back — it would run for free — and a scheduled errand whose search
 *     window hasn't opened (a runner would be sent hours early), exactly like
 *     the customer's own "try again".
 *   - "Return to matching" takes an accepted-but-unfinished errand off its
 *     runner, tells them, wipes their progress and offers it to someone else
 *     (never back to them) with a fresh search window; a runner who already
 *     paid for the items is flagged to staff as owed.
 *   - "Mark completed" settles it exactly like the runner's own completion,
 *     once; it pays the runner, so only money roles have it, and an errand
 *     whose money went back can't be completed.
 *   - Every new round (re-run, return) gets a full search window and fresh
 *     offers, so a rescue long after the errand was placed isn't ended by the
 *     first auto-cancel check.
 *
 * AutoCancelBookingJob is faked throughout: on the sync test queue a delay is
 * ignored, and a job re-arming itself for a future deadline would loop.
 */
class StuckErrandActionsTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private ErrandType $type;
    private AdminUser $admin;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        Bus::fake([AutoCancelBookingJob::class]);

        $this->admin = AdminUser::create([
            'email' => 'ops@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops', 'role' => AdminUser::ROLE_OPS, 'is_active' => true,
        ]);
        $this->actingAs($this->admin, 'admin');

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 0]);
        $this->runner = $this->makeRunner(14.6001);
        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeRunner(float $lat): User
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 0]);
        RunnerProfile::create([
            'user_id' => $runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'vehicle_type' => 'motorcycle', 'current_lat' => $lat, 'current_lng' => 120.98,
            'last_location_at' => now(), 'preferred_types' => [],
            'total_errands' => 0, 'total_earnings' => 0, 'completion_rate' => 100,
        ]);

        return $runner;
    }

    private function booking(array $overrides = [], string $paymentStatus = 'paid', string $method = 'wallet'): Booking
    {
        $booking = Booking::create(array_merge([
            'booking_number' => 'EG-STK-'.strtoupper(substr(md5(uniqid('', true)), 0, 6)),
            'customer_id' => $this->customer->id, 'errand_type_id' => $this->type->id,
            'status' => 'pending',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 100,
            'payment_method' => $method, 'payment_status' => $paymentStatus,
            'is_transportation' => false,
        ], $overrides));

        Payment::create([
            'booking_id' => $booking->id, 'customer_id' => $this->customer->id, 'amount' => 115,
            'method' => $method,
            'status' => $paymentStatus === 'paid' ? 'completed' : ($method === 'cash' ? 'pending' : $paymentStatus),
            'paid_at' => $paymentStatus === 'paid' ? now() : null,
        ]);

        return $booking;
    }

    private function accepted(array $overrides = [], string $paymentStatus = 'paid', string $method = 'wallet'): Booking
    {
        return $this->booking(array_merge([
            'status' => 'picked_up',
            'runner_id' => $this->runner->id,
            'matched_at' => now()->subMinutes(20),
            'accepted_at' => now()->subMinutes(19),
            'offered_runner_ids' => [$this->runner->id],
            'offer_count' => 1,
        ], $overrides), $paymentStatus, $method);
    }

    // ── Re-run matching ─────────────────────────────────────────────────

    public function test_re_run_matching_refuses_an_errand_whose_payment_was_refunded(): void
    {
        Bus::fake([MatchRunnerJob::class, AutoCancelBookingJob::class]);
        $booking = $this->booking(['status' => 'no_runner'], 'refunded');

        Livewire::test(ListBookings::class)->callTableAction('rematch', $booking);

        $this->assertSame('no_runner', $booking->fresh()->status);
        Bus::assertNotDispatched(MatchRunnerJob::class);
    }

    public function test_re_run_matching_refuses_failed_or_expired_online_payments(): void
    {
        foreach (['failed', 'expired'] as $status) {
            $booking = $this->booking(['status' => 'no_runner', 'payment_method' => 'gcash'], $status, 'gcash');

            try {
                app(BookingService::class)->adminRematch($booking->id);
                $this->fail("re-run matching accepted a {$status} payment");
            } catch (BookingStateException $e) {
                $this->assertStringContainsString('run it for free', $e->getMessage());
            }
        }
    }

    public function test_bulk_re_run_skips_refunded_and_not_yet_due_errands(): void
    {
        Bus::fake([MatchRunnerJob::class, AutoCancelBookingJob::class]);
        $refunded = $this->booking(['status' => 'no_runner'], 'refunded');
        $later = $this->booking(['schedule_type' => 'scheduled', 'scheduled_at' => now()->addHours(4)]);
        $stuckCash = $this->booking(['status' => 'no_runner', 'offer_count' => 5], 'unpaid', 'cash');

        Livewire::test(ListBookings::class)
            ->callTableBulkAction('rematchSelected', [$refunded, $later, $stuckCash]);

        Bus::assertDispatchedTimes(MatchRunnerJob::class, 1);
        Bus::assertDispatched(MatchRunnerJob::class, fn (MatchRunnerJob $job) => $job->bookingId === $stuckCash->id);
        $this->assertSame('pending', $stuckCash->fresh()->status);
        $this->assertSame(0, $stuckCash->fresh()->offer_count, 'a staff re-run starts a fresh round of offers');
        $this->assertSame('no_runner', $refunded->fresh()->status);
    }

    public function test_re_run_matching_respects_a_scheduled_errands_time(): void
    {
        Bus::fake([MatchRunnerJob::class, AutoCancelBookingJob::class]);
        $later = $this->booking(['schedule_type' => 'scheduled', 'scheduled_at' => now()->addHours(4)]);

        try {
            app(BookingService::class)->adminRematch($later->id);
            $this->fail('a future scheduled errand was dispatched now');
        } catch (BookingStateException $e) {
            $this->assertStringContainsString('Matching starts on its own', $e->getMessage());
        }
        Bus::assertNotDispatched(MatchRunnerJob::class);

        // Once its window is open, staff can re-run it.
        $due = $this->booking(['schedule_type' => 'scheduled', 'scheduled_at' => now()->addMinutes(10)]);
        app(BookingService::class)->adminRematch($due->id);
        Bus::assertDispatched(MatchRunnerJob::class, fn (MatchRunnerJob $job) => $job->bookingId === $due->id);
    }

    // ── Return to matching ──────────────────────────────────────────────

    public function test_return_to_matching_takes_the_errand_off_its_runner_and_offers_it_to_someone_else(): void
    {
        Event::fake();
        $other = $this->makeRunner(14.6100);
        $booking = $this->accepted();

        Livewire::test(ListBookings::class)
            ->callTableAction('returnToMatching', $booking, ['reason' => 'Runner’s motorbike broke down'])
            ->assertHasNoTableActionErrors();

        $fresh = $booking->fresh();
        // Re-offered — to the other runner, never back to the one taken off it
        // (who is still online and nearer).
        $this->assertSame('matched', $fresh->status);
        $this->assertSame($other->id, $fresh->runner_id);
        $this->assertContains($this->runner->id, $fresh->offered_runner_ids);
        $this->assertSame('paid', $fresh->payment_status);

        $this->assertDatabaseHas('booking_status_logs', [
            'booking_id' => $booking->id, 'status' => 'pending',
            'note' => 'Staff returned the errand to matching: Runner’s motorbike broke down',
        ]);
        $this->assertTrue(Notification::where('user_id', $this->runner->id)->where('title', 'Errand reassigned')->exists());
        $this->assertTrue(Notification::where('user_id', $this->customer->id)->where('title', 'Finding you a new runner')->exists());
        $this->assertTrue(Activity::where('event', 'booking.returned_to_matching')->where('subject_id', $booking->id)->exists());
    }

    public function test_return_to_matching_needs_a_reason(): void
    {
        $booking = $this->accepted();

        Livewire::test(ListBookings::class)
            ->callTableAction('returnToMatching', $booking, ['reason' => ''])
            ->assertHasTableActionErrors(['reason' => 'required']);

        $this->assertSame('picked_up', $booking->fresh()->status);
    }

    public function test_return_to_matching_refuses_an_errand_whose_money_went_back(): void
    {
        $booking = $this->accepted([], 'refunded');

        $this->expectException(BookingStateException::class);
        app(BookingService::class)->adminReturnToMatching($booking->id, 'test');
    }

    public function test_return_to_matching_only_applies_to_an_accepted_unfinished_errand(): void
    {
        $booking = $this->booking(['status' => 'pending']);

        Livewire::test(ListBookings::class)
            ->assertTableActionHidden('returnToMatching', $booking)
            ->assertTableActionHidden('markCompleted', $booking);

        $this->expectException(BookingStateException::class);
        app(BookingService::class)->adminReturnToMatching($booking->id, 'test');
    }

    // ── Mark completed ──────────────────────────────────────────────────

    public function test_mark_completed_settles_exactly_like_a_runner_completion(): void
    {
        Event::fake();
        $this->actingAs($this->staff(AdminUser::ROLE_FINANCE), 'admin');
        $booking = $this->accepted();

        Livewire::test(ListBookings::class)
            ->callTableAction('markCompleted', $booking, ['reason' => 'Runner’s phone died at the drop-off'])
            ->assertHasNoTableActionErrors();

        $fresh = $booking->fresh();
        $this->assertSame('completed', $fresh->status);
        $this->assertNotNull($fresh->completed_at);
        // Paid booking → the runner's payout is credited to their wallet, once.
        $this->assertEquals(100.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(1, WalletTransaction::where('user_id', $this->runner->id)
            ->where('reference_id', $booking->id)->where('type', 'earning')->count());
        $profile = $this->runner->runnerProfile->fresh();
        $this->assertSame(1, (int) $profile->total_errands);
        $this->assertEquals(100.0, (float) $profile->total_earnings);
        $this->assertDatabaseHas('payments', ['booking_id' => $booking->id, 'status' => 'completed']);
        $this->assertTrue(Activity::where('event', 'booking.marked_completed')->where('subject_id', $booking->id)->exists());
        Event::assertDispatched(\App\Events\BookingStatusChanged::class, fn ($e) => $e->newStatus === 'completed'
            && $e->oldStatus === 'picked_up');
    }

    public function test_mark_completed_runs_once(): void
    {
        Event::fake();
        $booking = $this->accepted();
        $service = app(BookingService::class);

        $service->adminMarkCompleted($booking->id, $this->admin->id, 'done');

        try {
            $service->adminMarkCompleted($booking->id, $this->admin->id, 'done again');
            $this->fail('an errand was completed twice');
        } catch (BookingStateException) {
            // expected
        }

        $this->assertEquals(100.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(1, (int) $this->runner->runnerProfile->fresh()->total_errands);
    }

    public function test_mark_completed_on_a_cash_errand_takes_the_platform_commission(): void
    {
        Event::fake();
        $booking = $this->accepted([], 'unpaid', 'cash');

        app(BookingService::class)->adminMarkCompleted($booking->id, $this->admin->id, 'Customer confirmed by phone');

        // The runner collected ₱115 in cash and keeps ₱100, so they owe ₱15.
        $this->assertEquals(-15.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->runner->id, 'reference_id' => $booking->id, 'type' => 'commission',
        ]);
        // The cash payment is recorded as collected, attributed to staff.
        $this->assertDatabaseHas('payments', ['booking_id' => $booking->id, 'status' => 'completed']);
        $this->assertDatabaseHas('payment_status_transitions', [
            'to_status' => 'completed', 'actor' => "admin:{$this->admin->id}",
        ]);
    }

    public function test_the_rescue_actions_are_for_ops_and_admins_only(): void
    {
        $booking = $this->accepted();

        $this->actingAs($this->staff(AdminUser::ROLE_SUPPORT), 'admin');

        Livewire::test(ListBookings::class)
            ->assertTableActionHidden('returnToMatching', $booking)
            ->assertTableActionHidden('markCompleted', $booking);
    }

    public function test_mark_completed_pays_the_runner_so_only_money_roles_have_it(): void
    {
        $booking = $this->accepted();

        // Ops (the setUp signed-in staff) and admins return errands to
        // matching, but don't pay runners.
        Livewire::test(ListBookings::class)
            ->assertTableActionVisible('returnToMatching', $booking)
            ->assertTableActionHidden('markCompleted', $booking);

        $this->actingAs($this->staff(AdminUser::ROLE_ADMIN), 'admin');
        Livewire::test(ListBookings::class)
            ->assertTableActionVisible('returnToMatching', $booking)
            ->assertTableActionVisible('cancel', $booking)
            ->assertTableActionHidden('markCompleted', $booking);

        $this->actingAs($this->staff(AdminUser::ROLE_FINANCE), 'admin');
        Livewire::test(ListBookings::class)
            ->assertTableActionVisible('markCompleted', $booking)
            ->assertTableActionHidden('returnToMatching', $booking);

        $this->actingAs($this->staff(AdminUser::ROLE_SUPER_ADMIN), 'admin');
        Livewire::test(ListBookings::class)
            ->assertTableActionVisible('markCompleted', $booking)
            ->assertTableActionVisible('returnToMatching', $booking);
    }

    public function test_mark_completed_says_whether_and_how_the_runner_is_paid(): void
    {
        $this->actingAs($this->staff(AdminUser::ROLE_FINANCE), 'admin');

        Livewire::test(ListBookings::class)
            ->mountTableAction('markCompleted', $this->accepted())
            ->assertMountedActionModalSee('The runner is paid ₱100.00 into their ErrandGuy wallet.');

        Livewire::test(ListBookings::class)
            ->mountTableAction('markCompleted', $this->accepted([], 'unpaid', 'cash'))
            ->assertMountedActionModalSee('The runner keeps the ₱115.00 cash they collect from the customer, and ErrandGuy’s ₱15.00 fee is taken from their wallet.');

        Livewire::test(ListBookings::class)
            ->mountTableAction('markCompleted', $this->accepted([], 'refunded'))
            ->assertMountedActionModalSee('Its payment was refunded or never collected, so it can’t be marked completed');
    }

    public function test_mark_completed_refuses_an_errand_whose_money_went_back(): void
    {
        Event::fake();

        foreach ([['refunded', 'wallet'], ['failed', 'gcash'], ['expired', 'gcash']] as [$paymentStatus, $method]) {
            $booking = $this->accepted(['payment_method' => $method], $paymentStatus, $method);

            try {
                app(BookingService::class)->adminMarkCompleted($booking->id, $this->admin->id, 'done');
                $this->fail("a {$paymentStatus} errand was marked completed");
            } catch (BookingStateException $e) {
                $this->assertStringContainsString('Cancel it instead', $e->getMessage());
            }

            $this->assertSame('picked_up', $booking->fresh()->status);
        }

        $this->assertEquals(0.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertSame(0, (int) $this->runner->runnerProfile->fresh()->total_errands);
    }

    // ── Fresh rounds ────────────────────────────────────────────────────

    public function test_return_to_matching_long_after_booking_gets_a_full_new_search_window(): void
    {
        Bus::fake([MatchRunnerJob::class, AutoCancelBookingJob::class]);
        $booking = $this->accepted(['matching_started_at' => now()->subHours(2)]);
        $booking->forceFill(['created_at' => now()->subHours(2)])->save();

        app(BookingService::class)->adminReturnToMatching($booking->id, 'Runner went dark');

        $fresh = $booking->fresh();
        $this->assertSame('pending', $fresh->status);
        $this->assertTrue($fresh->matching_started_at->between(now()->subMinute(), now()));
        $deadline = BookingService::matchingDeadline($fresh);
        $this->assertTrue($deadline->between(now()->addMinutes(29), now()->addMinutes(31)), 'a full 30-minute window');

        // The auto-cancel is armed for the NEW deadline…
        Bus::assertDispatched(AutoCancelBookingJob::class, fn (AutoCancelBookingJob $job) => $job->bookingId === $booking->id
            && $job->delay !== null && \Illuminate\Support\Carbon::parse($job->delay)->equalTo($deadline));
        // …so neither an old check nor the reaper ends it early.
        $this->assertFalse((new AutoCancelBookingJob($booking->id))->handle());
        $this->artisan('errandguy:reap-stranded-bookings')->assertSuccessful();
        $this->assertSame('pending', $booking->fresh()->status);
        $this->assertSame('paid', $booking->fresh()->payment_status);
    }

    public function test_re_run_matching_long_after_booking_gets_a_full_new_search_window(): void
    {
        Bus::fake([MatchRunnerJob::class, AutoCancelBookingJob::class]);
        $booking = $this->booking([
            'status' => 'no_runner', 'offer_count' => 5, 'matching_started_at' => now()->subHours(3),
            'offered_runner_ids' => [$this->runner->id],
        ], 'unpaid', 'cash');
        $booking->forceFill(['created_at' => now()->subHours(3)])->save();

        app(BookingService::class)->adminRematch($booking->id);

        $fresh = $booking->fresh();
        $this->assertSame('pending', $fresh->status);
        $this->assertSame(0, $fresh->offer_count);
        $this->assertNull($fresh->offered_runner_ids, 'a runner who only missed an offer can be offered it again');
        $this->assertTrue(BookingService::matchingDeadline($fresh)->greaterThan(now()->addMinutes(29)));
        Bus::assertDispatched(AutoCancelBookingJob::class, fn (AutoCancelBookingJob $job) => $job->bookingId === $booking->id);
        $this->assertFalse((new AutoCancelBookingJob($booking->id))->handle());
        $this->assertSame('pending', $booking->fresh()->status);
    }

    public function test_a_new_round_offers_the_errand_again_to_a_runner_who_missed_it(): void
    {
        Event::fake();
        // Cash, no_runner after the only nearby runner let the offer lapse.
        $booking = $this->booking([
            'status' => 'no_runner', 'offer_count' => 1, 'offered_runner_ids' => [$this->runner->id],
        ], 'unpaid', 'cash');

        app(BookingService::class)->adminRematch($booking->id);

        $fresh = $booking->fresh();
        $this->assertSame('matched', $fresh->status);
        $this->assertSame($this->runner->id, $fresh->runner_id);
        $this->assertSame([$this->runner->id], $fresh->offered_runner_ids);
        $this->assertSame(1, $fresh->offer_count);
    }

    public function test_return_to_matching_keeps_only_the_removed_runner_excluded(): void
    {
        Bus::fake([MatchRunnerJob::class, AutoCancelBookingJob::class]);
        $earlier = $this->makeRunner(14.6200);
        $booking = $this->accepted(['offered_runner_ids' => [$earlier->id, $this->runner->id], 'offer_count' => 2]);

        app(BookingService::class)->adminReturnToMatching($booking->id, 'Runner asked to drop it');

        $fresh = $booking->fresh();
        $this->assertSame([$this->runner->id], $fresh->offered_runner_ids);
        $this->assertSame(0, $fresh->offer_count);
        Bus::assertDispatched(MatchRunnerJob::class, fn (MatchRunnerJob $job) => $job->excludeUserId === $this->runner->id);
    }

    public function test_a_scheduled_errand_past_its_window_is_searched_for_like_one_booked_for_now(): void
    {
        Bus::fake([MatchRunnerJob::class, AutoCancelBookingJob::class]);
        $booking = $this->accepted([
            'schedule_type' => 'scheduled', 'scheduled_at' => now()->subHour(),
            'matching_started_at' => now()->subMinutes(75),
        ]);

        app(BookingService::class)->adminReturnToMatching($booking->id, 'Runner went dark');

        $fresh = $booking->fresh();
        $this->assertSame('now', $fresh->schedule_type);
        $this->assertTrue(BookingService::matchingDeadline($fresh)->between(now()->addMinutes(29), now()->addMinutes(31)));
        // Searched right away, not held for a window that already closed.
        Bus::assertDispatched(MatchRunnerJob::class, fn (MatchRunnerJob $job) => $job->delay === null);
        $this->assertFalse((new AutoCancelBookingJob($booking->id))->handle());
    }

    public function test_a_scheduled_errand_still_ahead_of_its_window_keeps_waiting_for_it(): void
    {
        Bus::fake([MatchRunnerJob::class, AutoCancelBookingJob::class]);
        $scheduledAt = now()->addHours(3);
        $booking = $this->accepted(['schedule_type' => 'scheduled', 'scheduled_at' => $scheduledAt]);

        app(BookingService::class)->adminReturnToMatching($booking->id, 'Runner took it too early');

        $fresh = $booking->fresh();
        $this->assertSame('scheduled', $fresh->schedule_type);
        $this->assertNull($fresh->matching_started_at, 'the scheduled-matching sweep can still start it');
        Bus::assertDispatched(MatchRunnerJob::class, fn (MatchRunnerJob $job) => $job->delay !== null);
    }

    // ── Return to matching: the first runner's work ─────────────────────

    public function test_return_to_matching_wipes_the_first_runners_progress(): void
    {
        Bus::fake([MatchRunnerJob::class, AutoCancelBookingJob::class]);
        $booking = $this->accepted([
            'picked_up_at' => now()->subMinutes(10),
            'pickup_photo_url' => 'https://api.test/media/pickup.jpg',
            'delivery_photo_url' => 'https://api.test/media/delivery.jpg',
            'shopping_budget' => 500,
            'shopping_items' => [
                ['id' => 'i1', 'name' => 'Rice', 'qty' => 1, 'checked' => true, 'checked_at' => now()->toIso8601String()],
                ['id' => 'i2', 'name' => 'Eggs', 'qty' => 12, 'checked' => false, 'checked_at' => null],
            ],
        ]);
        $stop = BookingStop::create([
            'booking_id' => $booking->id, 'sequence' => 1, 'address' => 'C', 'lat' => 14.5, 'lng' => 121.0,
            'completed_at' => now()->subMinutes(5),
        ]);

        app(BookingService::class)->adminReturnToMatching($booking->id, 'Runner went dark');

        $fresh = $booking->fresh();
        $this->assertNull($fresh->picked_up_at);
        $this->assertNull($fresh->pickup_photo_url);
        $this->assertNull($fresh->delivery_photo_url);
        $this->assertNull($fresh->accepted_at);
        $this->assertSame([false, false], array_column($fresh->shopping_items, 'checked'));
        $this->assertSame(['Rice', 'Eggs'], array_column($fresh->shopping_items, 'name'), 'the list itself stays');
        $this->assertNull($stop->fresh()->completed_at);
        // Nothing was spent on items, so there is nothing to flag.
        $this->assertFalse(AdminAlert::where('type', 'runner_owed_items')->exists());
    }

    public function test_a_runner_who_already_paid_for_the_items_is_flagged_as_owed(): void
    {
        Bus::fake([MatchRunnerJob::class, AutoCancelBookingJob::class]);
        $booking = $this->accepted([
            'shopping_budget' => 500,
            'actual_item_cost' => 450,
            'receipt_photo_url' => 'https://api.test/media/receipt.jpg',
        ]);

        // Staff are told before they confirm.
        Livewire::test(ListBookings::class)
            ->mountTableAction('returnToMatching', $booking)
            ->assertMountedActionModalSee('already paid ₱450.00 for the customer’s items and is owed it');

        app(BookingService::class)->adminReturnToMatching($booking->id, 'Runner’s bike broke down');

        $fresh = $booking->fresh();
        $this->assertNull($fresh->actual_item_cost);
        $this->assertNull($fresh->receipt_photo_url);

        $alert = AdminAlert::where('type', 'runner_owed_items')->sole();
        $this->assertSame($booking->id, $alert->subject_id);
        $this->assertSame(
            \App\Filament\Resources\Bookings\BookingResource::getUrl('view', ['record' => $booking->id]),
            \App\Filament\Widgets\LiveAlertsWidget::linkFor($alert),
            'the alert opens the errand',
        );
        $this->assertStringContainsString('paid ₱450.00 for the items', $alert->body);
        $this->assertStringContainsString('is owed it', $alert->body);
        // The amount and the receipt stay on the errand's history.
        $this->assertDatabaseHas('booking_status_logs', [
            'booking_id' => $booking->id,
            'note' => 'Staff returned the errand to matching: Runner’s bike broke down. The first runner had paid ₱450.00 '
                .'for the items (receipt: https://api.test/media/receipt.jpg)',
        ]);
    }

    private function staff(string $role): AdminUser
    {
        return AdminUser::create([
            'email' => $role.'-'.uniqid().'@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => ucfirst($role), 'role' => $role, 'is_active' => true,
        ]);
    }
}
