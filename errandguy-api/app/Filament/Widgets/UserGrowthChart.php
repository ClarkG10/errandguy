<?php

namespace App\Filament\Widgets;

use App\Models\User;
use App\Support\AdminCache;
use App\Support\AdminChartData;
use Filament\Support\RawJs;
use Filament\Widgets\ChartWidget;

/**
 * New customer vs runner signups per day — the two-sided marketplace growth
 * picture. Watch for supply (runners) keeping pace with demand (customers).
 */
class UserGrowthChart extends ChartWidget
{
    protected static ?int $sort = 7;

    protected ?string $heading = 'Marketplace growth';

    protected ?string $description = 'New customer vs runner signups, by day.';

    protected int|string|array $columnSpan = 'full';

    protected ?string $maxHeight = '280px';

    public ?string $filter = '30';

    protected function getFilters(): ?array
    {
        return ['14' => 'Last 14 days', '30' => 'Last 30 days', '90' => 'Last 90 days'];
    }

    protected function getData(): array
    {
        $days = (int) $this->filter;

        [$customers, $runners, $labels] = AdminCache::rememberFor(AdminCache::CHART_USER_GROWTH.':'.$days, 300, function () use ($days): array {
            $custMap = AdminChartData::emptyDailyMap($days);
            $runMap = $custMap;

            User::query()
                ->where('created_at', '>=', AdminChartData::since($days))
                ->whereIn('role', ['customer', 'runner'])
                ->selectRaw("to_char(created_at, 'YYYY-MM-DD') as d, role, count(*) as c")
                ->groupBy('d', 'role')
                ->get()
                ->each(function ($row) use (&$custMap, &$runMap): void {
                    if ($row->role === 'customer' && array_key_exists($row->d, $custMap)) {
                        $custMap[$row->d] = (int) $row->c;
                    } elseif ($row->role === 'runner' && array_key_exists($row->d, $runMap)) {
                        $runMap[$row->d] = (int) $row->c;
                    }
                });

            return [array_values($custMap), array_values($runMap), AdminChartData::labels($custMap, $days)];
        });

        return [
            'datasets' => [
                [
                    'label' => 'Customers',
                    'data' => $customers,
                    'borderColor' => '#2563eb',
                    'backgroundColor' => 'rgba(37, 99, 235, 0.12)',
                    'fill' => true,
                    'tension' => 0.35,
                    'borderWidth' => 2,
                    'pointRadius' => 0,
                    'pointHoverRadius' => 4,
                ],
                [
                    'label' => 'Runners',
                    'data' => $runners,
                    'borderColor' => '#10b981',
                    'backgroundColor' => 'rgba(16, 185, 129, 0.12)',
                    'fill' => true,
                    'tension' => 0.35,
                    'borderWidth' => 2,
                    'pointRadius' => 0,
                    'pointHoverRadius' => 4,
                ],
            ],
            'labels' => $labels,
        ];
    }

    protected function getType(): string
    {
        return 'line';
    }

    protected function getOptions(): RawJs
    {
        return RawJs::make(<<<'JS'
            {
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: true, position: 'top', labels: { usePointStyle: true, boxWidth: 8 } },
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(148,163,184,0.15)' } },
                    x: { grid: { display: false } },
                },
            }
        JS);
    }
}
