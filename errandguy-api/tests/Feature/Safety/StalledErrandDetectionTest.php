<?php

namespace Tests\Feature\Safety;

use App\Models\AdminAlert;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\SystemConfig;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Guards the stall detector (cluster A4) — the notify-only half.
 *
 * Before it, a runner who went dark reached no human at all. These tests pin
 * that errandguy:detect-stalled-errands raises exactly one operator alert per
 * stalled booking (an open SOS included), and stays quiet for fresh,
 * not-yet-due-scheduled and config-disabled cases.
 *
 * Everything here is notify-only by design: no test asserts a status change, a
 * cancellation or any money movement, because the command performs none.
 */
class StalledErrandDetectionTest extends TestCase
{
    use RefreshDatabase;

    private function errandType(string $slug = 'delivery'): ErrandType
    {
        return ErrandType::firstOrCreate(['slug' => $slug], [
            'name' => ucfirst($slug), 'description' => $slug,
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 0, 'per_km_bicycle' => 0,
            'per_km_motorcycle' => 10, 'per_km_car' => 18,
            'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeErrand(array $overrides = []): Booking
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $runner = User::factory()->create(['role' => 'runner']);
        $type = $this->errandType($overrides['__slug'] ?? 'delivery');
        unset($overrides['__slug']);

        return Booking::create(array_merge([
            'booking_number' => 'EG-S-'.substr(uniqid(), -10),
            'customer_id' => $customer->id, 'runner_id' => $runner->id,
            'errand_type_id' => $type->id, 'status' => 'accepted',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false, 'sos_triggered' => false,
        ], $overrides));
    }

    /** Push the booking's progress marker into the past without touching state. */
    private function idleFor(Booking $booking, int $minutes): void
    {
        DB::table('bookings')->where('id', $booking->id)
            ->update(['updated_at' => now()->subMinutes($minutes)]);
    }

    private function stalledAlerts(): int
    {
        return AdminAlert::where('type', 'stalled_errand')->count();
    }

    public function test_raises_an_operator_alert_for_an_errand_with_no_progress(): void
    {
        $booking = $this->makeErrand(); // 'accepted', default threshold 30min
        $this->idleFor($booking, 90);

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $alert = AdminAlert::where('type', 'stalled_errand')->first();
        $this->assertNotNull($alert, 'A 90-minute-idle accepted errand must raise an operator alert.');
        $this->assertSame('warning', $alert->severity);
        // subject_id is the booking, so the feed can deep-link to the record.
        $this->assertSame($booking->id, $alert->subject_id);
        $this->assertStringContainsString($booking->booking_number, (string) $alert->body);

        // Notify-only: the booking itself is untouched.
        $this->assertSame('accepted', $booking->fresh()->status);
    }

    public function test_no_alert_for_an_errand_that_is_still_progressing(): void
    {
        $booking = $this->makeErrand();
        $this->idleFor($booking, 5); // well inside the 30min 'accepted' threshold

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(0, $this->stalledAlerts());
    }

    public function test_alerts_only_once_per_booking(): void
    {
        $booking = $this->makeErrand();
        $this->idleFor($booking, 90);

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();
        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();
        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(1, $this->stalledAlerts(), 'The cache flag must make the alert once-per-booking.');
    }

    public function test_an_open_sos_does_not_silence_the_stall_monitor(): void
    {
        // An SOS nobody acts on is exactly when an errand also stops moving:
        // staff need the stall signal too, not just the SOS.
        $booking = $this->makeErrand(['sos_triggered' => true]);
        $this->idleFor($booking, 90);

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(1, $this->stalledAlerts(), 'A stalled errand with an open SOS must still raise its stall alert.');
    }

    public function test_a_scheduled_errand_accepted_early_is_waiting_not_stalled(): void
    {
        // Runner accepted a booking scheduled for two hours from now: the row has
        // legitimately not changed since, but nothing is wrong.
        $booking = $this->makeErrand([
            'schedule_type' => 'scheduled',
            'scheduled_at' => now()->addHours(2),
        ]);
        $this->idleFor($booking, 90);

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(0, $this->stalledAlerts());
    }

    public function test_a_scheduled_errand_whose_window_has_long_passed_does_alert(): void
    {
        $booking = $this->makeErrand([
            'schedule_type' => 'scheduled',
            'scheduled_at' => now()->subHours(3),
        ]);
        $this->idleFor($booking, 180);

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(1, $this->stalledAlerts());
    }

    public function test_threshold_is_system_config_tunable(): void
    {
        $booking = $this->makeErrand();
        $this->idleFor($booking, 10); // inside the 30min default

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();
        $this->assertSame(0, $this->stalledAlerts());

        SystemConfig::setValue('stall_alert_minutes_accepted', '5');

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();
        $this->assertSame(1, $this->stalledAlerts(), 'A tightened threshold must take effect from system_config.');
    }

    public function test_a_zero_threshold_switches_one_status_off(): void
    {
        $booking = $this->makeErrand();
        $this->idleFor($booking, 90);
        SystemConfig::setValue('stall_alert_minutes_accepted', '0');

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(0, $this->stalledAlerts());
    }

    public function test_global_kill_switch_disables_detection(): void
    {
        $booking = $this->makeErrand();
        $this->idleFor($booking, 90);
        SystemConfig::setValue('stall_alert_enabled', '0');

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(0, $this->stalledAlerts());
    }

    public function test_a_status_nobody_is_holding_is_not_monitored(): void
    {
        // 'pending' has no runner at all, and ExpireStaleMatchesJob /
        // ReapStrandedBookingsCommand already cover it — not a runner stall.
        $this->idleFor($this->makeErrand(['status' => 'pending', 'runner_id' => null]), 300);

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(0, $this->stalledAlerts());
    }

    public function test_a_delivered_errand_that_never_completed_is_alerted(): void
    {
        // 'delivered' was excluded on the reasoning that it waits on the
        // customer's confirm tap — but no customer confirm endpoint exists, and
        // settlement happens only in the 'completed' branch. So an errand parked
        // here pays the runner NOTHING while every other backstop skips it and
        // the customer's Activity screen files it under completed. Nobody was
        // watching the one state where the work is done and the money is not.
        $this->idleFor($this->makeErrand(['status' => 'delivered']), 300);

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(1, $this->stalledAlerts());
    }

    public function test_a_legacy_ride_in_transit_is_watched_like_any_other_errand(): void
    {
        // The ride-duration monitor is gone with passenger rides, so a ride
        // still in progress from before the retirement is no longer carved out
        // of the in-transit slice: it is alerted like a delivery would be.
        $ride = $this->makeErrand([
            '__slug' => 'transportation',
            'status' => 'in_transit',
            'is_transportation' => true,
            'picked_up_at' => now()->subHours(3),
        ]);
        $this->idleFor($ride, 180);

        $delivery = $this->makeErrand(['status' => 'in_transit']);
        $this->idleFor($delivery, 180);

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(2, $this->stalledAlerts());
        $this->assertEqualsCanonicalizing(
            [$ride->id, $delivery->id],
            AdminAlert::where('type', 'stalled_errand')->pluck('subject_id')->all(),
        );
    }

    public function test_dry_run_reports_without_raising_or_consuming_the_flag(): void
    {
        $booking = $this->makeErrand();
        $this->idleFor($booking, 90);

        $this->artisan('errandguy:detect-stalled-errands --dry-run')->assertSuccessful();
        $this->assertSame(0, $this->stalledAlerts(), 'A dry run must raise nothing.');

        // …and must not have burned the once-per-booking claim.
        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();
        $this->assertSame(1, $this->stalledAlerts());
    }

    public function test_a_queue_runner_standing_in_line_for_hours_is_not_stalled(): void
    {
        // On a queue errand 'arrived_at_pickup' is "I'm in line" and
        // 'picked_up' is "my turn — finishing up". Both can last hours.
        $inLine = $this->makeErrand(['__slug' => 'queue', 'status' => 'arrived_at_pickup']);
        $this->idleFor($inLine, 180);
        $atTheWindow = $this->makeErrand(['__slug' => 'queue', 'status' => 'picked_up']);
        $this->idleFor($atTheWindow, 90);

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(0, $this->stalledAlerts());
    }

    public function test_a_queue_errand_idle_past_its_own_threshold_still_alerts(): void
    {
        $inLine = $this->makeErrand(['__slug' => 'queue', 'status' => 'arrived_at_pickup']);
        $this->idleFor($inLine, 400);

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(1, $this->stalledAlerts());
        $this->assertSame($inLine->id, AdminAlert::where('type', 'stalled_errand')->value('subject_id'));
    }

    public function test_a_delivery_at_the_same_status_keeps_its_short_threshold(): void
    {
        $delivery = $this->makeErrand(['status' => 'arrived_at_pickup']);
        $this->idleFor($delivery, 90);

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(1, $this->stalledAlerts());
    }

    public function test_switching_a_status_off_switches_it_off_for_queue_errands_too(): void
    {
        SystemConfig::setValue('stall_alert_minutes_arrived_at_pickup', '0');
        $inLine = $this->makeErrand(['__slug' => 'queue', 'status' => 'arrived_at_pickup']);
        $this->idleFor($inLine, 1000);

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(0, $this->stalledAlerts());
    }
}
