<?php

namespace App\Filament\Widgets;

use App\Models\Booking;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Support\AdminCache;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

class AdminStatsOverview extends StatsOverviewWidget
{
    protected static ?int $sort = 1;

    protected ?string $pollingInterval = '60s';

    protected int|string|array $columnSpan = 'full';

    // Six KPIs across one row on wide screens; wraps gracefully below.
    protected int|array|null $columns = 3;

    protected function getStats(): array
    {
        // Everything cached together for 60s (Redis on prod) so the widget
        // doesn't fire a dozen COUNT/SUM queries at the remote DB per render.
        $d = AdminCache::remember(AdminCache::STATS, function (): array {
            $todayStart = today();
            $yesterdayStart = today()->subDay();

            $gmv = fn ($from, $to) => (float) Booking::where('status', 'completed')
                ->where('completed_at', '>=', $from)
                ->where('completed_at', '<', $to)
                ->sum('total_amount');

            $revenue = fn ($from, $to) => (float) Booking::where('status', 'completed')
                ->where('completed_at', '>=', $from)
                ->where('completed_at', '<', $to)
                ->sum('service_fee');

            $completed = fn ($from, $to) => Booking::where('status', 'completed')
                ->where('completed_at', '>=', $from)
                ->where('completed_at', '<', $to)
                ->count();

            // 7-day GMV sparkline (oldest → newest).
            $spark = [];
            for ($i = 6; $i >= 0; $i--) {
                $dayStart = today()->subDays($i);
                $spark[] = $gmv($dayStart, $dayStart->copy()->addDay());
            }

            return [
                'customers' => User::where('role', 'customer')->count(),
                'customers_new_today' => User::where('role', 'customer')->where('created_at', '>=', $todayStart)->count(),
                'runners' => User::where('role', 'runner')->count(),
                'runners_online' => RunnerProfile::where('is_online', true)->count(),
                'active_bookings' => Booking::whereNotIn('status', ['completed', 'cancelled', 'no_runner'])->count(),
                'gmv_today' => $gmv($todayStart, today()->addDay()),
                'gmv_yesterday' => $gmv($yesterdayStart, $todayStart),
                'gmv_spark' => $spark,
                'revenue_today' => $revenue($todayStart, today()->addDay()),
                'completed_today' => $completed($todayStart, today()->addDay()),
                'completed_yesterday' => $completed($yesterdayStart, $todayStart),
            ];
        });

        return [
            Stat::make('Customers', number_format($d['customers']))
                ->description($d['customers_new_today'] > 0 ? '+'.number_format($d['customers_new_today']).' today' : 'No new signups today')
                ->descriptionIcon('heroicon-m-user-plus')
                ->color('primary'),

            Stat::make('Runners', number_format($d['runners']))
                ->description(number_format($d['runners_online']).' online now')
                ->descriptionIcon('heroicon-m-signal')
                ->color($d['runners_online'] > 0 ? 'success' : 'gray'),

            Stat::make('Active bookings', number_format($d['active_bookings']))
                ->description('In flight right now')
                ->descriptionIcon('heroicon-m-bolt')
                ->color('info'),

            $this->trendStat('GMV today', '₱'.number_format($d['gmv_today'], 2), $d['gmv_today'], $d['gmv_yesterday'])
                ->chart($d['gmv_spark']),

            $this->trendStat('Completed today', number_format($d['completed_today']), $d['completed_today'], $d['completed_yesterday']),

            Stat::make('Platform revenue today', '₱'.number_format($d['revenue_today'], 2))
                ->description('Service fees on completed errands')
                ->descriptionIcon('heroicon-m-building-library')
                ->color('success'),
        ];
    }

    /**
     * Build a stat with a vs-yesterday delta: green + up-arrow when growing,
     * rose + down-arrow when shrinking, gray when flat.
     */
    private function trendStat(string $label, string $value, float $today, float $yesterday): Stat
    {
        if ($yesterday > 0) {
            $delta = (($today - $yesterday) / $yesterday) * 100;
            $desc = sprintf('%+.0f%% vs yesterday', $delta);
        } elseif ($today > 0) {
            $delta = 100;
            $desc = 'New activity vs yesterday';
        } else {
            $delta = 0;
            $desc = 'No change vs yesterday';
        }

        $color = $delta > 0 ? 'success' : ($delta < 0 ? 'danger' : 'gray');
        $icon = $delta > 0 ? 'heroicon-m-arrow-trending-up' : ($delta < 0 ? 'heroicon-m-arrow-trending-down' : 'heroicon-m-minus-small');

        return Stat::make($label, $value)
            ->description($desc)
            ->descriptionIcon($icon)
            ->color($color);
    }
}
