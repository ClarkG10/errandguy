<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\Bookings\Pages\ListBookings;
use App\Filament\Resources\Bookings\Widgets\BookingListStats;
use App\Filament\Widgets\AdminStatsOverview;
use App\Filament\Widgets\BookingsTrendChart;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use App\Support\AdminCache;
use App\Support\AdminChartData;
use App\Support\BusinessDay;
use Filament\Widgets\StatsOverviewWidget\Stat;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * "Today" on the dashboard and the daily chart bars are Manila calendar days.
 * Timestamps are stored in UTC, so an errand finished at 01:00 Manila time
 * (17:00 UTC the day before) belongs to today, and one at 23:00 Manila time
 * yesterday does not.
 */
class ManilaDayFiguresTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // 11:00 on Oct 31 in Manila.
        $this->travelTo(Carbon::parse('2026-10-31 03:00:00', 'UTC'));

        $this->actingAs(AdminUser::create([
            'email' => 'finance@errandguy.test', 'password_hash' => 'x',
            'full_name' => 'Finance', 'role' => 'finance', 'is_active' => true,
        ]), 'admin');

        // 01:00 Oct 31 Manila — today.
        $this->completedAt('TODAY', '2026-10-30 17:00:00', 200);
        // 23:00 Oct 30 Manila — yesterday (but "today" by UTC's calendar).
        $this->completedAt('YDAY', '2026-10-30 15:00:00', 100);
    }

    private function completedAt(string $suffix, string $utc, float $total): Booking
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::firstOrCreate(['slug' => 'delivery'], [
            'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);

        $booking = Booking::create([
            'booking_number' => 'EG-MNL-'.$suffix, 'customer_id' => $customer->id, 'errand_type_id' => $type->id,
            'status' => 'completed', 'payment_status' => 'paid',
            'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15, 'surcharge' => 0,
            'total_amount' => $total, 'runner_payout' => 85, 'is_transportation' => false,
            'completed_at' => $utc,
        ]);
        $booking->forceFill(['created_at' => $utc])->saveQuietly();

        return $booking;
    }

    /** @return array<string, Stat> */
    private function stats(object $widget): array
    {
        AdminCache::flush();
        $stats = (fn () => $this->getStats())->call($widget);

        return collect($stats)->mapWithKeys(fn (Stat $s): array => [(string) $s->getLabel() => $s])->all();
    }

    public function test_the_business_day_starts_at_manila_midnight(): void
    {
        $this->assertSame('2026-10-30 16:00:00', BusinessDay::start()->format('Y-m-d H:i:s'));
        $this->assertSame('UTC', BusinessDay::start()->getTimezone()->getName());
        $this->assertSame('2026-10-31', BusinessDay::date());
        $this->assertSame('2026-10-29 16:00:00', BusinessDay::startOf('2026-10-30')->format('Y-m-d H:i:s'));
    }

    public function test_dashboard_today_figures_count_the_manila_day(): void
    {
        $stats = $this->stats(new AdminStatsOverview);

        $this->assertSame('1', $stats['Completed today']->getValue());
        $this->assertSame('₱200.00', $stats['GMV today']->getValue());
        $this->assertSame('₱15.00', $stats['Platform revenue today']->getValue());

        $list = $this->stats(new BookingListStats);
        $this->assertSame('1', $list['Completed today']->getValue());
        $this->assertSame('1', $list['Placed today']->getValue());
        $this->assertSame('₱200.00', $list['GMV today']->getValue());
    }

    public function test_daily_chart_bars_bucket_by_manila_date(): void
    {
        $this->assertSame(['2026-10-30', '2026-10-31'], array_keys(AdminChartData::emptyDailyMap(2)));

        $buckets = Booking::query()
            ->selectRaw(AdminChartData::dayBucket('completed_at').' as d, booking_number')
            ->pluck('d', 'booking_number')
            ->all();
        $this->assertSame('2026-10-31', $buckets['EG-MNL-TODAY']);
        $this->assertSame('2026-10-30', $buckets['EG-MNL-YDAY']);

        AdminCache::flush();
        $data = (fn () => $this->getData())->call(Livewire::test(BookingsTrendChart::class, ['filter' => '7'])->instance());
        $completed = $data['datasets'][1]['data'];
        $this->assertSame([1, 1], array_slice($completed, -2), 'one completed bar on each Manila day');
    }

    public function test_the_date_filter_uses_manila_days(): void
    {
        Livewire::test(ListBookings::class)
            ->filterTable('created_at_range', ['from' => '2026-10-31', 'until' => '2026-10-31'])
            ->assertCanSeeTableRecords(Booking::where('booking_number', 'EG-MNL-TODAY')->get())
            ->assertCanNotSeeTableRecords(Booking::where('booking_number', 'EG-MNL-YDAY')->get());
    }
}
