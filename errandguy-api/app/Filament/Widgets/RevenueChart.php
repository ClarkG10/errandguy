<?php

namespace App\Filament\Widgets;

use App\Models\Booking;
use App\Support\AdminCache;
use App\Support\AdminChartData;
use Filament\Support\RawJs;
use Filament\Widgets\ChartWidget;

/**
 * GMV (total transacted) vs platform revenue (service fees) per day.
 */
class RevenueChart extends ChartWidget
{
    // GMV + platform revenue is money data — restrict to money roles
    // (super_admin / finance), matching PaymentResource::canViewAny. Without
    // this, the dashboard rendered revenue to support/ops. Widgets have no
    // policy fall-through, so the gate lives here.
    public static function canView(): bool
    {
        return auth('admin')->user()?->canManageMoney() ?? false;
    }

    protected static ?int $sort = 3;

    protected ?string $heading = 'Revenue';

    protected ?string $description = 'Gross merchandise value vs platform service-fee revenue, by day.';

    protected int|string|array $columnSpan = ['default' => 'full', 'lg' => 4];

    protected ?string $maxHeight = '280px';

    public ?string $filter = '30';

    protected function getFilters(): ?array
    {
        return ['7' => 'Last 7 days', '14' => 'Last 14 days', '30' => 'Last 30 days', '90' => 'Last 90 days'];
    }

    protected function getData(): array
    {
        $days = (int) $this->filter;

        [$gmv, $revenue, $labels] = AdminCache::rememberFor(AdminCache::CHART_REVENUE.':'.$days, 300, function () use ($days): array {
            $gmvMap = AdminChartData::emptyDailyMap($days);
            $revMap = $gmvMap;

            Booking::query()
                ->where('status', 'completed')
                ->where('completed_at', '>=', AdminChartData::since($days))
                ->selectRaw(AdminChartData::dayBucket('completed_at').' as d, sum(total_amount) as gmv, sum(service_fee) as rev')
                ->groupBy('d')
                ->get()
                ->each(function ($row) use (&$gmvMap, &$revMap): void {
                    if (array_key_exists($row->d, $gmvMap)) {
                        $gmvMap[$row->d] = (float) $row->gmv;
                        $revMap[$row->d] = (float) $row->rev;
                    }
                });

            return [array_values($gmvMap), array_values($revMap), AdminChartData::labels($gmvMap, $days)];
        });

        return [
            'datasets' => [
                [
                    'label' => 'GMV (₱)',
                    'data' => $gmv,
                    'borderColor' => '#2563eb',
                    'backgroundColor' => 'rgba(37, 99, 235, 0.12)',
                    'fill' => true,
                    'tension' => 0.35,
                    'borderWidth' => 2,
                    'pointRadius' => 0,
                    'pointHoverRadius' => 4,
                ],
                [
                    'label' => 'Platform revenue (₱)',
                    'data' => $revenue,
                    'borderColor' => '#ea580c',
                    'backgroundColor' => 'rgba(234, 88, 12, 0.10)',
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
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ctx.dataset.label + ': ₱' + Number(ctx.parsed.y).toLocaleString('en-PH', { minimumFractionDigits: 2 }),
                        },
                    },
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { callback: (v) => '₱' + Number(v).toLocaleString('en-PH') },
                        grid: { color: 'rgba(148,163,184,0.15)' },
                    },
                    x: { grid: { display: false } },
                },
            }
        JS);
    }
}
