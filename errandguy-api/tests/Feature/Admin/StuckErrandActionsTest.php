<?php

namespace Tests\Feature\Admin;

use App\Exceptions\BookingStateException;
use App\Filament\Resources\Bookings\Pages\ListBookings;
use App\Jobs\MatchRunnerJob;
use App\Models\AdminUser;
use App\Models\Booking;
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
 *     runner, tells them, and offers it to someone else (never back to them).
 *   - "Mark completed" settles it exactly like the runner's own completion,
 *     once.
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
        Bus::fake([MatchRunnerJob::class]);
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
        Bus::fake([MatchRunnerJob::class]);
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
        Bus::fake([MatchRunnerJob::class]);
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

        $this->actingAs(AdminUser::create([
            'email' => 'support@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Support', 'role' => AdminUser::ROLE_SUPPORT, 'is_active' => true,
        ]), 'admin');

        Livewire::test(ListBookings::class)
            ->assertTableActionHidden('returnToMatching', $booking)
            ->assertTableActionHidden('markCompleted', $booking);
    }
}
