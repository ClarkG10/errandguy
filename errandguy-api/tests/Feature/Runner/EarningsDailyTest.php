<?php

namespace Tests\Feature\Runner;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * GET /runner/earnings/daily — per-day totals for the earnings tab.
 *
 * The tab used to add up its day groups and week chart from ONE page of up to
 * 100 errands, so a busy month dropped its oldest days and showed the runner
 * smaller numbers than they earned. These tests pin the server figures that
 * replace that: every errand in the window counts, each on the Manila date it
 * was completed, and the days add up to the hero total.
 */
class EarningsDailyTest extends TestCase
{
    use RefreshDatabase;

    private const TZ = 'Asia/Manila';

    private User $customer;
    private User $runner;
    private ErrandType $errandType;
    private int $seq = 0;

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
            'completion_rate' => 100.00,
        ]);
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver',
            'icon_name' => 'Package', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'is_active' => true, 'sort_order' => 1,
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    public function test_a_month_of_more_than_100_errands_is_totalled_per_manila_day(): void
    {
        // Wed 30 Sep 2026, 20:00 Manila: the month runs 1–30 Sep.
        $this->freezeManila('2026-09-30 20:00');

        // Four errands on each of 1–28 Sep = 112, more than the 100 rows the
        // tab used to load. Two of each day's four sit right on the Manila
        // midnight seams: 00:30 Manila is 16:30 UTC the day BEFORE, and 23:30
        // Manila is 15:30 UTC the same day — so a UTC bucket would move the
        // 00:30 errand onto the previous date.
        $expected = [];
        for ($day = 1; $day <= 28; $day++) {
            $date = sprintf('2026-09-%02d', $day);
            $payout = 100 + $day;
            foreach (['00:30', '07:00', '16:30', '23:30'] as $time) {
                $this->completedAtManila("{$date} {$time}", $payout);
            }
            $expected[$date] = ['errands' => 4, 'earnings' => 4.0 * $payout];
        }

        // Last month, 23:30 on the 31st (15:30 UTC that day): out of the window.
        $this->completedAtManila('2026-08-31 23:30', 5000);

        $daily = $this->daily('this_month');

        $this->assertSame('Asia/Manila', $daily['timezone']);
        $this->assertSame(480, $daily['utc_offset_minutes']);

        $days = collect($daily['days'])->keyBy('date');
        $this->assertCount(28, $days, 'every day of the month has its row, none dropped');
        $this->assertArrayNotHasKey('2026-08-31', $days->all());
        foreach ($expected as $date => $want) {
            $this->assertSame($want['errands'], $days[$date]['errands'], "errands on {$date}");
            $this->assertSame($want['earnings'], (float) $days[$date]['earnings'], "earnings on {$date}");
        }

        // Newest first, the order the list below them is in.
        $this->assertSame('2026-09-28', $daily['days'][0]['date']);
        $this->assertSame('2026-09-01', $daily['days'][27]['date']);

        // The days add up to the hero, over all 112 errands.
        $summary = $this->summary('this_month');
        $this->assertSame(112, (int) $summary['total_errands']);
        $this->assertSame(
            round((float) $summary['total_earnings'], 2),
            round(collect($daily['days'])->sum('earnings'), 2),
        );
        $this->assertSame(112, collect($daily['days'])->sum('errands'));
    }

    public function test_an_errand_completed_at_2330_manila_lands_on_that_manila_day(): void
    {
        $this->freezeManila('2026-09-03 09:00');

        // Both at 15:30 / 16:30 UTC on 2 Sep — one UTC date — but two Manila
        // dates: 23:30 on the 2nd and 00:30 on the 3rd.
        $this->completedAtManila('2026-09-02 23:30', 130);
        $this->completedAtManila('2026-09-03 00:30', 140);

        $days = collect($this->daily('this_week')['days'])->keyBy('date');

        $this->assertSame(1, $days['2026-09-02']['errands']);
        $this->assertSame(130.0, (float) $days['2026-09-02']['earnings']);
        $this->assertSame(1, $days['2026-09-03']['errands']);
        $this->assertSame(140.0, (float) $days['2026-09-03']['earnings']);
    }

    public function test_today_only_counts_this_manila_day(): void
    {
        $this->freezeManila('2026-09-02 22:00');

        $this->completedAtManila('2026-09-02 07:00', 100);
        $this->completedAtManila('2026-09-01 23:30', 999);

        $daily = $this->daily('today');

        $this->assertSame([['date' => '2026-09-02', 'errands' => 1, 'earnings' => 100.0]], array_map(
            fn (array $d): array => ['date' => $d['date'], 'errands' => $d['errands'], 'earnings' => (float) $d['earnings']],
            $daily['days'],
        ));
    }

    public function test_tips_and_the_cash_share_are_reported_per_day(): void
    {
        $this->freezeManila('2026-09-02 22:00');

        $this->completedAtManila('2026-09-02 08:00', 100, ['payment_method' => 'cash', 'tip_amount' => 20]);
        $this->completedAtManila('2026-09-02 09:00', 60, ['payment_method' => 'gcash']);
        // Yesterday: one errand has no method on record, so no split for it.
        $this->completedAtManila('2026-09-01 09:00', 70, ['payment_method' => 'cash']);
        $this->completedAtManila('2026-09-01 10:00', 50, ['payment_method' => null]);

        $days = collect($this->daily('this_week')['days'])->keyBy('date');

        // Tips sit beside the payout, never inside it.
        $this->assertSame(160.0, (float) $days['2026-09-02']['earnings']);
        $this->assertSame(20.0, (float) $days['2026-09-02']['tips']);
        $this->assertSame(100.0, (float) $days['2026-09-02']['cash_earnings']);

        $this->assertSame(120.0, (float) $days['2026-09-01']['earnings']);
        $this->assertNull($days['2026-09-01']['cash_earnings']);
    }

    public function test_only_this_runners_completed_errands_count(): void
    {
        $this->freezeManila('2026-09-02 22:00');

        $this->completedAtManila('2026-09-02 08:00', 100);
        $this->booking([
            'status' => 'cancelled',
            'runner_id' => $this->runner->id,
            'runner_payout' => 500,
            'completed_at' => Carbon::parse('2026-09-02 09:00', self::TZ)->utc(),
        ]);
        $other = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $this->booking([
            'status' => 'completed',
            'runner_id' => $other->id,
            'runner_payout' => 700,
            'completed_at' => Carbon::parse('2026-09-02 10:00', self::TZ)->utc(),
        ]);

        $days = $this->daily('today')['days'];

        $this->assertCount(1, $days);
        $this->assertSame(1, $days[0]['errands']);
        $this->assertSame(100.0, (float) $days[0]['earnings']);
    }

    public function test_custom_range_reads_manila_dates_and_rejects_a_bad_date(): void
    {
        $this->freezeManila('2026-09-03 09:00');

        $this->completedAtManila('2026-09-02 23:30', 130);
        $this->completedAtManila('2026-09-03 00:30', 140);

        $days = $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/earnings/daily?period=custom&date_from=2026-09-01&date_to=2026-09-02')
            ->assertOk()
            ->json('data.days');
        $this->assertSame(['2026-09-02'], array_column($days, 'date'));

        $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/earnings/daily?period=custom&date_from=not-a-date')
            ->assertStatus(422);
    }

    public function test_an_empty_or_unknown_period_means_lifetime_as_the_summary_does(): void
    {
        $this->freezeManila('2026-09-03 09:00');

        $this->completedAtManila('2026-01-15 10:00', 70);
        $this->completedAtManila('2026-09-03 08:00', 30);

        foreach (['', 'lifetime'] as $period) {
            $days = $this->daily($period)['days'];
            $this->assertSame(['2026-09-03', '2026-01-15'], array_column($days, 'date'), "period={$period}");

            $this->assertSame(100.0, (float) $this->summary($period)['total_earnings'], "period={$period}");
        }
    }

    public function test_customers_cannot_read_it(): void
    {
        $this->actingAs($this->customer)
            ->getJson('/api/v1/runner/earnings/daily?period=today')
            ->assertForbidden();
    }

    // ── helpers ────────────────────────────────────────────────────────

    private function freezeManila(string $wallClock): void
    {
        Carbon::setTestNow(Carbon::parse($wallClock, self::TZ));
    }

    /** @return array<string,mixed> */
    private function daily(string $period): array
    {
        return $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/earnings/daily?period='.$period)
            ->assertOk()
            ->json('data');
    }

    /** @return array<string,mixed> */
    private function summary(string $period): array
    {
        return $this->actingAs($this->runner)
            ->getJson('/api/v1/runner/earnings?period='.$period)
            ->assertOk()
            ->json('data');
    }

    /** @param array<string,mixed> $extra */
    private function completedAtManila(string $wallClock, float $payout, array $extra = []): Booking
    {
        return $this->booking(array_merge([
            'status' => 'completed',
            'runner_id' => $this->runner->id,
            'runner_payout' => $payout,
            'completed_at' => Carbon::parse($wallClock, self::TZ)->utc(),
        ], $extra));
    }

    /** @param array<string,mixed> $attributes */
    private function booking(array $attributes): Booking
    {
        $this->seq++;

        return Booking::create(array_merge([
            'booking_number' => sprintf('EG-DAILY-%04d', $this->seq),
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
