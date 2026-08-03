<?php

namespace App\Filament\Widgets;

use App\Models\Booking;
use App\Support\AdminCache;
use App\Support\AdminChartData;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

/**
 * Health-of-operations KPIs over the trailing 30 days: how reliably the
 * marketplace is fulfilling demand.
 */
class OperationsKpis extends StatsOverviewWidget
{
    protected static ?int $sort = 10;

    protected ?string $pollingInterval = null;

    protected int|string|array $columnSpan = 'full';

    protected int|array|null $columns = 4;

    protected ?string $heading = 'Operations health';

    protected ?string $description = 'Trailing 30 days.';

    protected function getStats(): array
    {
        $d = AdminCache::rememberFor(AdminCache::CHART_BOOKINGS.':ops-kpis', 300, function (): array {
            $since = today()->subDays(30);
            $base = fn () => Booking::where('created_at', '>=', $since);

            $total = (clone $base())->count();
            $completed = (clone $base())->where('status', 'completed')->count();
            $cancelled = (clone $base())->where('status', 'cancelled')->count();
            $noRunner = (clone $base())->where('status', 'no_runner')->count();

            $avgMin = (float) Booking::where('status', 'completed')
                ->whereNotNull('accepted_at')->whereNotNull('completed_at')
                ->where('completed_at', '>=', $since)
                ->selectRaw('avg('.AdminChartData::minutesBetween('accepted_at', 'completed_at').') as m')
                ->value('m');

            return compact('total', 'completed', 'cancelled', 'noRunner', 'avgMin');
        });

        $pct = fn (int $n): string => $d['total'] > 0 ? number_format($n / $d['total'] * 100, 1).'%' : '—';
        $completionRate = $d['total'] > 0 ? $d['completed'] / $d['total'] * 100 : 0;
        $cancelRate = $d['total'] > 0 ? $d['cancelled'] / $d['total'] * 100 : 0;

        return [
            Stat::make('Completion rate', $pct($d['completed']))
                ->description(number_format($d['completed']).' of '.number_format($d['total']).' completed')
                ->descriptionIcon('heroicon-m-check-circle')
                ->color($completionRate >= 80 ? 'success' : ($completionRate >= 60 ? 'warning' : 'danger')),

            Stat::make('Cancellation rate', $pct($d['cancelled']))
                ->description(number_format($d['cancelled']).' cancelled')
                ->descriptionIcon('heroicon-m-x-circle')
                ->color($cancelRate <= 10 ? 'success' : ($cancelRate <= 20 ? 'warning' : 'danger')),

            Stat::make('No-runner rate', $pct($d['noRunner']))
                ->description(number_format($d['noRunner']).' went unmatched')
                ->descriptionIcon('heroicon-m-user-minus')
                ->color($d['noRunner'] === 0 ? 'success' : 'warning'),

            Stat::make('Avg fulfillment', $d['avgMin'] > 0 ? number_format($d['avgMin']).' min' : '—')
                ->description('Accepted → completed')
                ->descriptionIcon('heroicon-m-clock')
                ->color('info'),
        ];
    }
}
