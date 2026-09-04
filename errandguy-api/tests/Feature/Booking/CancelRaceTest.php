<?php

namespace Tests\Feature\Booking;

use App\Jobs\MatchRunnerJob;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Services\BookingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Tests\TestCase;

/**
 * Two people acting on one booking at the same time.
 *
 * Both paths here read the booking UNLOCKED and then wrote with an id-only
 * WHERE, so a decision made on a stale snapshot landed on top of a committed
 * one.
 *
 * HOW THE RACE IS ACTUALLY REPRODUCED — this matters, because the obvious test
 * is vacuous. Simply cancelling the row and then calling the handler proves
 * nothing: single-threaded, the handler's own read happens AFTER the mutation,
 * so it sees the cancel and the stale-snapshot condition never exists. Written
 * that way, five of these tests passed against the UNFIXED code.
 *
 * Instead `raceAfterFirstRead()` hooks Eloquent's `retrieved` event to commit
 * the other actor's change BETWEEN the handler's unlocked read and its locked
 * re-read — which is exactly the interleaving. Without the fix the handler then
 * acts on its stale in-memory status and the write lands; with the fix the
 * locked re-read sees the truth and refuses.
 */
class CancelRaceTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    private User $runner;

    private ErrandType $type;

    protected function setUp(): void
    {
        parent::setUp();

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $this->runner->id,
            'verification_status' => 'approved',
            'preferred_types' => ['delivery'],
        ]);
        $this->type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'D',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30,
            'is_active' => true, 'sort_order' => 1,
        ]);
    }

    /**
     * Commit `$changes` to the row the moment the handler first reads it.
     *
     * Fires once, on the FIRST `retrieved` event, then disarms — so it lands
     * after the unlocked read and before any locked re-read. Uses a query-builder
     * update so it writes straight past the model being hydrated.
     *
     * @param  array<string,mixed>  $changes
     */
    private function raceAfterFirstRead(string $bookingId, array $changes): void
    {
        $fired = false;

        Booking::retrieved(function (Booking $model) use (&$fired, $bookingId, $changes) {
            if ($fired || (string) $model->id !== $bookingId) {
                return;
            }
            $fired = true;
            Booking::whereKey($bookingId)->update($changes);
        });
    }

    private function booking(array $overrides = []): Booking
    {
        return Booking::create(array_merge([
            'booking_number' => 'EG-R-'.uniqid(),
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->type->id,
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ], $overrides));
    }

    /**
     * THE MONEY BUG. A customer cancels (free at 'matched') at the same moment
     * the matched runner declines. The cancel commits — refund issued, customer
     * told "cancelled, ₱X refunded". The decline then used to write
     * status='pending', runner_id=null on its stale snapshot, resurrecting the
     * row. MatchRunnerJob only guards on 'pending', so the dead errand was
     * re-dispatched; the next runner accepted, completed it, and
     * handleCompletion found payment_status='refunded' and credited them
     * NOTHING. A refunded customer got a runner at their door, and that runner
     * worked for free.
     */
    public function test_a_decline_cannot_resurrect_a_booking_the_customer_already_cancelled(): void
    {
        Bus::fake([MatchRunnerJob::class]);

        $booking = $this->booking([
            'status' => 'matched',
            'runner_id' => $this->runner->id,
            'payment_status' => 'paid',
        ]);

        // The customer's cancel commits in the window between the decline
        // handler's unlocked read and its locked re-read.
        $this->raceAfterFirstRead($booking->id, [
            'status' => 'cancelled',
            'cancelled_at' => now(),
            'payment_status' => 'refunded',
        ]);

        // The runner's decline now genuinely holds a stale pre-cancel view.
        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$booking->id}/decline")
            ->assertOk();

        $fresh = $booking->fresh();
        $this->assertSame('cancelled', $fresh->status, 'the cancel must stand');
        $this->assertSame('refunded', $fresh->payment_status);
        Bus::assertNotDispatched(MatchRunnerJob::class);
    }

    /** The ordinary decline must still work — the lock is a guard, not a wall. */
    public function test_a_normal_decline_still_reverts_and_re_dispatches(): void
    {
        Bus::fake([MatchRunnerJob::class]);

        $booking = $this->booking([
            'status' => 'matched',
            'runner_id' => $this->runner->id,
        ]);

        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$booking->id}/decline")
            ->assertOk();

        $fresh = $booking->fresh();
        $this->assertSame('pending', $fresh->status);
        $this->assertNull($fresh->runner_id);
        Bus::assertDispatched(MatchRunnerJob::class);
    }

    /**
     * A decline arriving after ANOTHER runner has accepted must not strip the
     * new runner off the errand.
     */
    public function test_a_stale_decline_cannot_unassign_a_runner_who_has_accepted(): void
    {
        Bus::fake([MatchRunnerJob::class]);

        $booking = $this->booking([
            'status' => 'matched',
            'runner_id' => $this->runner->id,
        ]);

        // Another runner accepts inside the same window.
        $other = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $this->raceAfterFirstRead($booking->id, [
            'status' => 'accepted',
            'runner_id' => $other->id,
        ]);

        // The original runner's decline is now rejected by the ownership guard
        // BEFORE the lock — either outcome is fine, the row must not change.
        $this->actingAs($this->runner)
            ->postJson("/api/v1/runner/errand/{$booking->id}/decline");

        $fresh = $booking->fresh();
        $this->assertSame('accepted', $fresh->status);
        $this->assertSame($other->id, $fresh->runner_id);
        Bus::assertNotDispatched(MatchRunnerJob::class);
    }

    /**
     * THE OTHER MONEY BUG. An admin cancels while the runner is completing.
     * adminCancel read unlocked, saw 'delivered', then its id-only UPDATE
     * blocked on the completion's lock and landed on top of it — flipping a
     * COMPLETED errand to cancelled after the runner was credited, counting it
     * against their completion_rate, and refunding the customer the full fare
     * for work that was delivered.
     */
    public function test_admin_cancel_refuses_a_booking_that_completed_first(): void
    {
        // NOTE: no race injection here, and that is the point. Post-fix,
        // adminCancel's only read IS the locked one, so injecting a write after
        // it would simulate a commit landing while we hold the row lock —
        // something MySQL cannot do. What is testable single-threaded is that
        // the precondition is enforced at all; that it is evaluated under the
        // lock is pinned by the arch guard below.
        $booking = $this->booking([
            'status' => 'completed',
            'runner_id' => $this->runner->id,
            'payment_status' => 'paid',
            'completed_at' => now(),
        ]);

        $admin = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->expectException(\App\Exceptions\BookingStateException::class);

        try {
            app(BookingService::class)->adminCancel($booking->id, $admin->id, 'ops');
        } finally {
            $fresh = $booking->fresh();
            $this->assertSame('completed', $fresh->status, 'a finished errand must stay finished');
            // …and the customer must NOT have been refunded for delivered work.
            $this->assertSame('paid', $fresh->payment_status);
            $this->assertEquals(0.0, (float) $this->customer->fresh()->wallet_balance);
        }
    }

    /** Admin cancel of a genuinely live errand must still work. */
    public function test_admin_cancel_still_works_on_a_live_errand(): void
    {
        $booking = $this->booking([
            'status' => 'accepted',
            'runner_id' => $this->runner->id,
            'payment_status' => 'cash',
        ]);
        $admin = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        app(BookingService::class)->adminCancel($booking->id, $admin->id, 'fraud review');

        $this->assertSame('cancelled', $booking->fresh()->status);
    }

    /**
     * Arch guard: what makes these two paths race-SAFE is that the precondition
     * and the write sit in one transaction behind `lockForUpdate`. A
     * single-threaded suite cannot prove an interleaving that the lock itself
     * prevents, so the shape is pinned directly — and this is the assertion
     * that fails if someone "simplifies" the lock away.
     */
    public function test_both_cancel_paths_check_and_write_under_a_row_lock(): void
    {
        $cases = [
            'decline' => [
                base_path('app/Http/Controllers/Runner/RunnerErrandController.php'),
                'DB::transaction(function () use ($id, $user) {',
            ],
            'adminCancel' => [
                base_path('app/Services/BookingService.php'),
                'DB::transaction(function () use ($bookingId, $adminId, $reason) {',
            ],
        ];

        foreach ($cases as $name => [$file, $opener]) {
            $source = (string) file_get_contents($file);
            $start = strpos($source, $opener);
            $this->assertNotFalse($start, "{$name} no longer wraps its cancel decision in a transaction");

            $block = substr($source, $start, 1200);
            $this->assertStringContainsString('lockForUpdate()', $block, "{$name} must re-read under a row lock");
            // …and the precondition must be INSIDE that block, not before it.
            $this->assertMatchesRegularExpression(
                '/lockForUpdate\(\)[\s\S]{0,600}?(status !== |isFinalized)/',
                $block,
                "{$name} must re-check its precondition on the LOCKED row",
            );
        }
    }

    /**
     * Independent of the lock: refundUnfulfilled must never pay out on a
     * completed errand, whatever calls it.
     */
    public function test_refund_unfulfilled_refuses_a_completed_booking(): void
    {
        $booking = $this->booking([
            'status' => 'completed',
            'runner_id' => $this->runner->id,
            'payment_status' => 'paid',
            'completed_at' => now(),
        ]);

        app(BookingService::class)->refundUnfulfilled($booking->id, 'should not happen');

        $this->assertSame('paid', $booking->fresh()->payment_status);
        $this->assertEquals(0.0, (float) $this->customer->fresh()->wallet_balance);
    }
}
