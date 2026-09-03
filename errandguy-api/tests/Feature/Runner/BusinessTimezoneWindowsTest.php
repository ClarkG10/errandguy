<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * The platform runs in the Philippines (UTC+8, no DST) while the app and the
 * database run in UTC. Every calendar boundary a runner READS — the "today"
 * earnings hero and its daily goal, the week/month tabs, the peak-hours grid
 * behind the busy-now nudge — therefore has to be bucketed on the Manila
 * clock, not on the raw UTC one.
 *
 * These tests pin the boundaries, because the earnings windows decide which
 * errands land in a figure runners reconcile against their payouts:
 *   - an errand completed 23:30 Manila belongs to THAT Manila day;
 *   - an errand completed 07:00 Manila belongs to the day in progress (under
 *     UTC bucketing it fell into "yesterday" — the day flipped at 08:00 local,
 *     mid-shift, and money already earned silently vanished from the hero);
 *   - a booking created 18:00 Manila sits in the grid's 18:00 cell, not 10:00.
 */
class BusinessTimezoneWindowsTest extends TestCase
{
    use RefreshDatabase;

    private const TZ = 'Asia/Manila';

    private User $customer;
    private User $runner;
    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $this->runner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'preferred_types' => [],
            'acceptance_rate' => 100.00,
            'completion_rate' => 100.00,
        ]);
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    // ── earnings: "today" is a Manila day ──────────────────────────────

    public function test_today_window_covers_the_manila_day_not_the_utc_one(): void
    {
        // 22:00 Wed 2 Sep in Manila = 14:00 UTC the same date.
        $this->freezeManila('2026-09-02 22:00');

        // 07:00 Manila today = 23:00 UTC YESTERDAY. The whole bug: under UTC
        // bucketing this errand dropped out of "today" at 08:00 local, while
        // the runner was still on the same shift.
        $earlyShift = $this->completedAtManila('EG-TZ-EARLY', '2026-09-02 07:00', 100);
        // 21:00 Manila today — inside either window.
        $evening = $this->completedAtManila('EG-TZ-EVE', '2026-09-02 21:00', 250);
        // 23:30 Manila YESTERDAY is genuinely yesterday, and must stay out.
        $lastNight = $this->completedAtManila('EG-TZ-PREV', '2026-09-01 23:30', 999);

        $summary = $this->earnings('today');
        $this->assertSame(350.0, (float) $summary['total_earnings']);
        $this->assertSame(2, (int) $summary['total_errands']);

        $ids = $this->historyIds('today');
        $this->assertContains($earlyShift->id, $ids, '07:00 Manila must count as today');
        $this->assertContains($evening->id, $ids);
        $this->assertNotContains($lastNight->id, $ids, 'yesterday 23:30 Manila must stay out of today');
    }

    public function test_an_errand_completed_at_2330_manila_stays_in_that_manila_day(): void
    {
        $late = null;

        // Still that evening: it counts.
        $this->freezeManila('2026-09-02 23:45');
        $late = $this->completedAtManila('EG-TZ-2330', '2026-09-02 23:30', 120);
        $this->assertContains($late->id, $this->historyIds('today'));
        $this->assertSame(120.0, (float) $this->earnings('today')['total_earnings']);

        // Half an hour later the Manila day has turned over: the same errand is
        // yesterday's, and the hero resets — at local midnight, not at 08:00.
        $this->freezeManila('2026-09-03 00:15');
        $this->assertNotContains($late->id, $this->historyIds('today'));
        $this->assertSame(0.0, (float) $this->earnings('today')['total_earnings']);
    }

    public function test_week_window_starts_on_the_manila_monday_midnight(): void
    {
        // Mon 7 Sep 2026, 03:00 Manila — 19:00 UTC on Sunday the 6th, i.e. the
        // UTC week has not even started yet.
        $this->freezeManila('2026-09-07 03:00');

        $thisWeek = $this->completedAtManila('EG-TZ-WEEKIN', '2026-09-07 01:00', 300);
        $lastWeek = $this->completedAtManila('EG-TZ-WEEKOUT', '2026-09-06 23:30', 400);

        $summary = $this->earnings('this_week');
        $this->assertSame(300.0, (float) $summary['total_earnings']);
        $this->assertSame(1, (int) $summary['total_errands']);

        $ids = $this->historyIds('this_week');
        $this->assertContains($thisWeek->id, $ids);
        $this->assertNotContains($lastWeek->id, $ids, 'Sunday 23:30 Manila belongs to last week');
    }

    public function test_month_window_starts_on_the_manila_first_of_the_month(): void
    {
        // 01:00 on 1 Sep in Manila = 17:00 UTC on 31 Aug.
        $this->freezeManila('2026-09-01 01:00');

        $thisMonth = $this->completedAtManila('EG-TZ-MONIN', '2026-09-01 00:30', 210);
        $lastMonth = $this->completedAtManila('EG-TZ-MONOUT', '2026-08-31 23:30', 220);

        $summary = $this->earnings('this_month');
        $this->assertSame(210.0, (float) $summary['total_earnings']);

        $ids = $this->historyIds('this_month');
        $this->assertContains($thisMonth->id, $ids);
        $this->assertNotContains($lastMonth->id, $ids);
    }

    public function test_custom_range_dates_are_manila_calendar_dates(): void
    {
        $this->freezeManila('2026-09-03 09:00');

        // 23:30 on the last requested day, Manila time = 15:30 UTC that day.
        // A UTC end-of-day bound kept it; a UTC start-of-day bound for
        // date_from would have dropped the first day's evening. Both ends are
        // now read as Manila dates.
        $inRange = $this->completedAtManila('EG-TZ-CUSTIN', '2026-09-02 23:30', 130);
        $afterRange = $this->completedAtManila('EG-TZ-CUSTOUT', '2026-09-03 00:30', 140);

        $summary = $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/earnings?period=custom&date_from=2026-09-01&date_to=2026-09-02')
            ->assertOk()
            ->json('data');
        $this->assertSame(130.0, (float) $summary['total_earnings']);

        $ids = collect($this->actingAs($this->runner)
            ->getJson('/api/v1/runner/earnings/history?period=custom&date_from=2026-09-01&date_to=2026-09-02')
            ->assertOk()
            ->json('data'))->pluck('id')->all();
        $this->assertContains($inRange->id, $ids);
        $this->assertNotContains($afterRange->id, $ids);
    }

    public function test_history_and_summary_agree_on_the_window(): void
    {
        $this->freezeManila('2026-09-02 20:00');

        $this->completedAtManila('EG-TZ-AGREE-1', '2026-09-02 07:30', 100);
        $this->completedAtManila('EG-TZ-AGREE-2', '2026-09-02 19:00', 100);
        $this->completedAtManila('EG-TZ-AGREE-3', '2026-09-01 22:00', 100);

        $summary = $this->earnings('today');
        $this->assertSame(
            (int) $summary['total_errands'],
            count($this->historyIds('today')),
            'the per-errand list must not drift from the hero total',
        );
    }

    // ── peak hours: the grid is indexed by the Manila wall clock ───────

    public function test_peak_hours_buckets_a_booking_on_its_manila_hour(): void
    {
        // Create the booking at 18:00 Manila (10:00 UTC) — auto timestamps pick
        // up the frozen clock, so created_at is the instant under test.
        $this->freezeManila('2026-09-02 18:00');
        $this->pendingBooking('EG-TZ-PEAK');

        $this->freezeManila('2026-09-02 22:00');
        Cache::flush();

        $grid = $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/peak-hours?days=30')
            ->assertOk()
            ->json('data.grid');

        // Wed 2 Sep 2026 → dow 3 (0=Sun). The Manila hour is 18, and the UTC
        // hour it used to be filed under is 10.
        $this->assertSame(1, $grid[3][18], 'a 6pm Manila booking belongs in the 18:00 cell');
        $this->assertSame(0, $grid[3][10], 'and must no longer sit in the UTC 10:00 cell');
        $this->assertSame(1, collect($grid)->flatten()->sum());
    }

    public function test_peak_hours_day_of_week_follows_the_manila_date(): void
    {
        // 00:30 Wed 2 Sep in Manila is still Tuesday 16:30 in UTC: the cell has
        // to be Wednesday's, or the whole grid wraps a day at the edges.
        $this->freezeManila('2026-09-02 00:30');
        $this->pendingBooking('EG-TZ-DOW');

        $this->freezeManila('2026-09-02 22:00');
        Cache::flush();

        $grid = $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/peak-hours?days=30')
            ->assertOk()
            ->json('data.grid');

        $this->assertSame(1, $grid[3][0], 'Wednesday 00:30 Manila → dow 3, hour 0');
        $this->assertSame(0, $grid[2][16], 'not Tuesday 16:00 UTC');
    }

    // ── helpers ────────────────────────────────────────────────────────

    private function freezeManila(string $wallClock): void
    {
        Carbon::setTestNow(Carbon::parse($wallClock, self::TZ));
    }

    /** @return array<int,string> */
    private function historyIds(string $period): array
    {
        return collect(
            $this->actingAs($this->runner)
                ->getJson('/api/v1/runner/earnings/history?period=' . $period)
                ->assertOk()
                ->json('data')
        )->pluck('id')->all();
    }

    /** @return array<string,mixed> */
    private function earnings(string $period): array
    {
        return $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/earnings?period=' . $period)
            ->assertOk()
            ->json('data');
    }

    /**
     * A completed errand for this runner, stamped at a Manila wall-clock time.
     * The value is converted to UTC before it is stored, because Eloquent
     * writes a Carbon in whatever timezone it carries.
     */
    private function completedAtManila(string $number, string $wallClock, float $payout): Booking
    {
        return $this->booking($number, [
            'status' => 'completed',
            'runner_id' => $this->runner->id,
            'runner_payout' => $payout,
            'completed_at' => Carbon::parse($wallClock, self::TZ)->utc(),
        ]);
    }

    private function pendingBooking(string $number): Booking
    {
        return $this->booking($number, ['status' => 'pending']);
    }

    /** @param array<string,mixed> $attributes */
    private function booking(string $number, array $attributes): Booking
    {
        return Booking::create(array_merge([
            'booking_number' => $number,
            'customer_id' => $this->customer->id,
            'errand_type_id' => $this->errandType->id,
            'status' => 'pending',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 121.00,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 100,
            'is_transportation' => false,
        ], $attributes));
    }
}
