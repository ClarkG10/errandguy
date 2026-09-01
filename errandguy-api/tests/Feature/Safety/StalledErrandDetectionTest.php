<?php

namespace Tests\Feature\Safety;

use App\Events\RideDurationAlert;
use App\Models\AdminAlert;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\SystemConfig;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Guards the stall detector (cluster A4) — the notify-only half.
 *
 * Before it, the ONLY duration monitor was CheckRideDurationJob
 * (is_transportation + in_transit), and its sole listener ended in a log line
 * and an SMS TODO, so a runner who went dark reached no human at all. These
 * tests pin the two halves that now close that loop:
 *   1. errandguy:detect-stalled-errands raises exactly one operator alert per
 *      stalled booking, and stays quiet for fresh, SOS'd, not-yet-due-scheduled
 *      and config-disabled cases; and
 *   2. SendSafetyAlertNotification::handleDurationAlert raises an AdminAlert and
 *      tells BOTH parties instead of only writing a log line.
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
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30,
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

    public function test_a_booking_with_a_live_sos_is_skipped(): void
    {
        $booking = $this->makeErrand(['sos_triggered' => true]);
        $this->idleFor($booking, 90);

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(0, $this->stalledAlerts(), 'An SOS already has its own critical alert — do not pile on.');
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
        // 'delivered' waits on the CUSTOMER's confirm tap, and 'pending' has no
        // runner at all — neither is a runner stall.
        $this->idleFor($this->makeErrand(['status' => 'delivered']), 300);
        $this->idleFor($this->makeErrand(['status' => 'pending', 'runner_id' => null]), 300);

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(0, $this->stalledAlerts());
    }

    public function test_an_in_transit_ride_is_left_to_the_ride_duration_monitor(): void
    {
        // CheckRideDurationJob already judges this exact slice against a
        // distance-derived estimate — a flat clock here would double-alert and
        // would fire on every genuinely long ride.
        $ride = $this->makeErrand([
            '__slug' => 'transportation',
            'status' => 'in_transit',
            'is_transportation' => true,
            'picked_up_at' => now()->subHours(3),
        ]);
        $this->idleFor($ride, 180);

        // …but a NON-transportation errand in transit has no other monitor.
        $delivery = $this->makeErrand(['status' => 'in_transit']);
        $this->idleFor($delivery, 180);

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(1, $this->stalledAlerts());
        $this->assertSame(
            $delivery->id,
            AdminAlert::where('type', 'stalled_errand')->value('subject_id'),
        );
    }

    public function test_a_ride_stuck_before_pickup_is_still_covered(): void
    {
        // Nothing else watches a driver who accepted and never set off.
        $ride = $this->makeErrand([
            '__slug' => 'transportation',
            'status' => 'heading_to_pickup',
            'is_transportation' => true,
        ]);
        $this->idleFor($ride, 90);

        $this->artisan('errandguy:detect-stalled-errands')->assertSuccessful();

        $this->assertSame(1, $this->stalledAlerts());
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

    /**
     * The transportation monitor's listener used to end in a Log::warning and a
     * trusted-contact SMS path with no provider behind it — so the detection
     * reached nobody. It must now raise an operator alert AND tell both parties.
     */
    public function test_duration_alert_reaches_the_operator_and_both_parties(): void
    {
        $booking = $this->makeErrand([
            '__slug' => 'transportation',
            'status' => 'in_transit',
            'is_transportation' => true,
            'picked_up_at' => now()->subHours(3),
        ]);

        event(new RideDurationAlert($booking, 180, 15));

        $alert = AdminAlert::where('type', 'ride_duration')->first();
        $this->assertNotNull($alert, 'The duration monitor must no longer be log-only.');
        $this->assertSame($booking->id, $alert->subject_id);

        $this->assertSame(1, Notification::where('user_id', $booking->customer_id)->count());
        $this->assertSame(1, Notification::where('user_id', $booking->runner_id)->count());

        $customerNote = Notification::where('user_id', $booking->customer_id)->first();
        $this->assertSame('duration_alert', $customerNote->data['reason'] ?? null);
        $this->assertSame($booking->id, $customerNote->data['booking_id'] ?? null);
    }

    public function test_duration_alert_does_not_re_notify_on_a_repeat_fire(): void
    {
        $booking = $this->makeErrand([
            '__slug' => 'transportation',
            'status' => 'in_transit',
            'is_transportation' => true,
            'picked_up_at' => now()->subHours(3),
        ]);

        event(new RideDurationAlert($booking, 180, 15));
        event(new RideDurationAlert($booking, 210, 15));

        $this->assertSame(1, AdminAlert::where('type', 'ride_duration')->count());
        $this->assertSame(1, Notification::where('user_id', $booking->customer_id)->count());
    }
}
