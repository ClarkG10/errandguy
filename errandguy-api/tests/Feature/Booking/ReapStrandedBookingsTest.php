<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * Covers the wall-clock reaper (errandguy:reap-stranded-bookings) that recovers
 * prepaid bookings whose delayed AutoCancelBookingJob never ran (worker down, or
 * a crash before it was dispatched). (SCALE-REL-1/5)
 */
class ReapStrandedBookingsTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        Event::fake(); // avoid queued cancel-notification side effects; the
                       // cancel + refund run synchronously inside handle().
        // Pin the auto-cancel window deterministically. SystemConfig::getValue
        // caches for 1h in the array store, which is NOT cleared between tests,
        // so without this the value the reaper reads leaks from whatever an
        // earlier test in the suite cached (the seeded default is only 5m). Flush
        // first, then set 30m so the "inside 30m" fixtures below are stable.
        Cache::flush();
        \App\Models\SystemConfig::setValue('auto_cancel_timeout_minutes', '30');
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

    private function makeBooking(
        string $status,
        string $paymentStatus,
        string $method = 'wallet',
        ?\DateTimeInterface $createdAt = null,
        string $pricingMode = 'fixed',
        ?\DateTimeInterface $negotiateExpiresAt = null,
        ?\DateTimeInterface $scheduledAt = null,
    ): Booking {
        $booking = Booking::create([
            'booking_number' => 'EG-REAP-'.strtoupper(substr(md5($status.$paymentStatus.microtime()), 0, 6)),
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->errandType->id, 'status' => $status,
            'pickup_address' => '1 A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '2 B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => $scheduledAt !== null ? 'scheduled' : 'now',
            'scheduled_at' => $scheduledAt,
            'pricing_mode' => $pricingMode, 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'payment_method' => $method, 'payment_status' => $paymentStatus,
            'negotiate_expires_at' => $negotiateExpiresAt,
            'is_transportation' => false,
        ]);

        if ($createdAt !== null) {
            // created_at is not in Booking::$fillable, so set it directly
            // (mass-assignment via update() would silently drop it). save()
            // never auto-overwrites created_at, only updated_at.
            $booking->created_at = $createdAt;
            $booking->save();
        }

        if ($paymentStatus === 'paid') {
            Payment::create([
                'booking_id' => $booking->id, 'customer_id' => $this->customer->id,
                'amount' => 115, 'method' => $method, 'status' => 'completed', 'paid_at' => now(),
            ]);
        }

        return $booking;
    }

    private function reap(): void
    {
        $this->artisan('errandguy:reap-stranded-bookings')->assertExitCode(0);
    }

    public function test_reaps_a_prepaid_pending_booking_stranded_past_the_timeout(): void
    {
        // The exact SCALE-REL-1/5 scenario: prepaid, still pending, well past the
        // 30m window, and NO delayed AutoCancelBookingJob was ever dispatched.
        $booking = $this->makeBooking('pending', 'paid', 'wallet', now()->subHours(2));

        $this->reap();

        $fresh = $booking->fresh();
        $this->assertEquals('cancelled', $fresh->status);
        $this->assertEquals('refunded', $fresh->payment_status);
        $this->assertEquals(115.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund', 'reference_id' => $booking->id,
        ]);
        $this->assertDatabaseHas('payments', [
            'booking_id' => $booking->id, 'status' => 'refunded',
        ]);
    }

    public function test_does_not_reap_a_booking_still_within_the_timeout(): void
    {
        $booking = $this->makeBooking('pending', 'paid', 'wallet', now()->subMinutes(5)); // well inside 30m

        $this->reap();

        $fresh = $booking->fresh();
        $this->assertEquals('pending', $fresh->status);
        $this->assertEquals('paid', $fresh->payment_status);
        $this->assertEquals(0.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertDatabaseMissing('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund',
        ]);
    }

    public function test_does_not_reap_a_booking_a_runner_already_accepted(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $booking = $this->makeBooking('accepted', 'paid', 'wallet', now()->subHours(2));
        $booking->update(['runner_id' => $runner->id]); // runner_id IS fillable

        $this->reap();

        $fresh = $booking->fresh();
        $this->assertEquals('accepted', $fresh->status);
        $this->assertEquals('paid', $fresh->payment_status);
        $this->assertDatabaseMissing('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund', 'reference_id' => $booking->id,
        ]);
    }

    public function test_is_idempotent_across_repeated_runs(): void
    {
        $booking = $this->makeBooking('pending', 'paid', 'wallet', now()->subHours(2));

        $this->reap();
        $this->reap(); // a second sweep must not double-refund

        $this->assertEquals(115.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertEquals(
            1,
            WalletTransaction::where('reference_id', $booking->id)->where('type', 'refund')->count(),
        );
    }

    public function test_reaps_a_paid_no_runner_booking_that_never_refunded(): void
    {
        // no_runner is normally refunded by MatchRunnerJob; if that refund was
        // skipped (crash after the status write), the reaper still recovers it.
        $booking = $this->makeBooking('no_runner', 'paid', 'wallet', now()->subHours(2));

        $this->reap();

        $fresh = $booking->fresh();
        $this->assertEquals('cancelled', $fresh->status);
        $this->assertEquals('refunded', $fresh->payment_status);
        $this->assertEquals(115.0, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_cash_stranded_booking_is_cancelled_without_a_refund(): void
    {
        // Cash collected nothing up front → cancel it, but no money moves.
        $booking = $this->makeBooking('pending', 'unpaid', 'cash', now()->subHours(2));

        $this->reap();

        $this->assertEquals('cancelled', $booking->fresh()->status);
        $this->assertEquals(0.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertDatabaseMissing('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund',
        ]);
    }

    public function test_reaps_a_stranded_negotiate_booking_past_its_expiry(): void
    {
        // Negotiate offer prepaid up front, still pending with no runner, and its
        // negotiate window already elapsed — the delayed ExpireNegotiateBookingJob
        // never ran. Recovered via the negotiate branch (not the auto-cancel one).
        $booking = $this->makeBooking(
            'pending', 'paid', 'wallet', now()->subHours(2), 'negotiate', now()->subHour(),
        );

        $this->reap();

        $fresh = $booking->fresh();
        $this->assertEquals('cancelled', $fresh->status);
        $this->assertEquals('refunded', $fresh->payment_status);
        $this->assertEquals(115.0, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_does_not_reap_a_negotiate_booking_still_within_its_window(): void
    {
        // The critical safety case: a valid, still-OPEN negotiate offer must NOT
        // be cancelled — even though it was created before the 30m fixed-mode
        // auto-cancel cutoff. The fixed branch skips it (wrong pricing_mode) and
        // the negotiate branch skips it (negotiate_expires_at is in the future).
        $booking = $this->makeBooking(
            'pending', 'paid', 'wallet', now()->subHours(2), 'negotiate', now()->addMinutes(3),
        );

        $this->reap();

        $fresh = $booking->fresh();
        $this->assertEquals('pending', $fresh->status);
        $this->assertEquals('paid', $fresh->payment_status);
        $this->assertDatabaseMissing('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund',
        ]);
    }

    public function test_does_not_reap_a_scheduled_booking_before_its_window(): void
    {
        // CRITICAL regression: a scheduled booking is created 'pending' well
        // before its scheduled time (created_at is old, but scheduled_at is in
        // the future). Its primary AutoCancelBookingJob is delayed to
        // ~scheduled_at, so the reaper must anchor on scheduled_at — anchoring on
        // created_at would destroy a valid future booking.
        $booking = $this->makeBooking(
            'pending', 'paid', 'wallet', now()->subHours(2), 'fixed', null, now()->addHours(3),
        );

        $this->reap();

        $fresh = $booking->fresh();
        $this->assertEquals('pending', $fresh->status);
        $this->assertEquals('paid', $fresh->payment_status);
        $this->assertDatabaseMissing('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund',
        ]);
    }

    public function test_reaps_a_scheduled_booking_past_its_window(): void
    {
        // A scheduled booking whose scheduled time (and the auto-cancel grace
        // after it) has passed with no runner — its delayed job never ran, so
        // the reaper recovers it.
        $booking = $this->makeBooking(
            'pending', 'paid', 'wallet', now()->subDays(2), 'fixed', null, now()->subHours(1),
        );

        $this->reap();

        $fresh = $booking->fresh();
        $this->assertEquals('cancelled', $fresh->status);
        $this->assertEquals('refunded', $fresh->payment_status);
        $this->assertEquals(115.0, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_reaps_an_immediate_booking_even_with_a_stray_future_scheduled_at(): void
    {
        // Robustness: a malformed 'now' booking that also carries a future
        // scheduled_at must anchor on created_at (the schedule_type discriminator),
        // NOT the stray scheduled_at — otherwise it would be under-reaped for hours.
        $booking = $this->makeBooking(
            'pending', 'paid', 'wallet', now()->subHours(2), 'fixed', null, now()->addHours(5),
        );
        $booking->update(['schedule_type' => 'now']); // stray scheduled_at on a 'now' booking

        $this->reap();

        $fresh = $booking->fresh();
        $this->assertEquals('cancelled', $fresh->status);
        $this->assertEquals('refunded', $fresh->payment_status);
    }

    public function test_reaps_a_negotiate_crash_orphan_with_null_expiry(): void
    {
        // A negotiate booking charged up front but crashed before
        // negotiate_expires_at was written (so its delayed expire job was never
        // dispatched). Recovered via the null-expiry fallback once well past the
        // negotiate window.
        $booking = $this->makeBooking('pending', 'paid', 'wallet', now()->subHours(2), 'negotiate', null);

        $this->reap();

        $fresh = $booking->fresh();
        $this->assertEquals('cancelled', $fresh->status);
        $this->assertEquals('refunded', $fresh->payment_status);
        $this->assertEquals(115.0, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_does_not_reap_a_scheduled_negotiate_orphan_before_its_time(): void
    {
        // Even a null-expiry negotiate orphan must NOT be reaped while it is a
        // future SCHEDULED booking — the fallback anchors on scheduled_at for
        // scheduled rows.
        $booking = $this->makeBooking(
            'pending', 'paid', 'wallet', now()->subHours(2), 'negotiate', null, now()->addHours(5),
        );

        $this->reap();

        $fresh = $booking->fresh();
        $this->assertEquals('pending', $fresh->status);
        $this->assertEquals('paid', $fresh->payment_status);
    }

    public function test_recovers_a_refund_failure_orphan_cancelled_but_still_paid(): void
    {
        // The two-tx gap: a job committed the cancel (status='cancelled') but its
        // separate refund transaction threw, leaving payment_status='paid'. The
        // reaper completes the missed full refund.
        $booking = $this->makeBooking('cancelled', 'paid');
        $booking->update(['cancelled_at' => now()->subMinutes(10)]);

        $this->reap();

        $fresh = $booking->fresh();
        $this->assertEquals('cancelled', $fresh->status);
        $this->assertEquals('refunded', $fresh->payment_status);
        $this->assertEquals(115.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund', 'reference_id' => $booking->id,
        ]);
    }

    public function test_does_not_touch_an_already_refunded_cancelled_booking(): void
    {
        // Fully-settled cancel (paid→refunded) must be left alone — no double refund.
        $booking = $this->makeBooking('cancelled', 'refunded');
        $booking->update(['cancelled_at' => now()->subMinutes(10)]);

        $this->reap();

        $this->assertEquals('refunded', $booking->fresh()->payment_status);
        $this->assertEquals(0.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertDatabaseMissing('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund',
        ]);
    }

    public function test_does_not_touch_a_freshly_cancelled_paid_booking_within_grace(): void
    {
        // Just cancelled — the originating job's refund may still be about to run,
        // so the grace holds the reaper off for a couple of minutes.
        $booking = $this->makeBooking('cancelled', 'paid');
        $booking->update(['cancelled_at' => now()->subSeconds(30)]);

        $this->reap();

        $this->assertEquals('paid', $booking->fresh()->payment_status);
        $this->assertDatabaseMissing('wallet_transactions', [
            'user_id' => $this->customer->id, 'type' => 'refund',
        ]);
    }

    public function test_orphan_recovery_is_idempotent(): void
    {
        $booking = $this->makeBooking('cancelled', 'paid');
        $booking->update(['cancelled_at' => now()->subMinutes(10)]);

        $this->reap();
        $this->reap(); // second sweep must not double-refund

        $this->assertEquals(115.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertEquals(
            1,
            WalletTransaction::where('reference_id', $booking->id)->where('type', 'refund')->count(),
        );
    }
}
