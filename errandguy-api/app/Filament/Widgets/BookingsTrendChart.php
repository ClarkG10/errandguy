<?php

namespace App\Filament\Widgets;

use App\Models\Booking;
use App\Support\AdminCache;
use App\Support\AdminChartData;
use Filament\Support\RawJs;
use Filament\Widgets\ChartWidget;

/**
 * Bookings placed vs completed, per day.
 */
class BookingsTrendChart extends ChartWidget
{
    protected static ?int $sort = 5;

    protected ?string $heading = 'Booking volume';

    protected ?string $description = 'Bookings placed vs completed, by day.';

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

        [$placed, $completed, $labels] = AdminCache::rememberFor(AdminCache::CHART_BOOKINGS.':'.$days, 300, function () use ($days): array {
            $placedMap = AdminChartData::emptyDailyMap($days);
            $completedMap = $placedMap;

            Booking::query()
                ->where('created_at', '>=', AdminChartData::since($days))
                ->selectRaw(AdminChartData::dayBucket('created_at').' as d, count(*) as c')
                ->groupBy('d')
                ->get()
                ->each(function ($row) use (&$placedMap): void {
                    if (array_key_exists($row->d, $placedMap)) {
                        $placedMap[$row->d] = (int) $row->c;
                    }
                });

            Booking::query()
                ->where('status', 'completed')
                ->where('completed_at', '>=', AdminChartData::since($days))
                ->selectRaw(AdminChartData::dayBucket('completed_at').' as d, count(*) as c')
                ->groupBy('d')
                ->get()
                ->each(function ($row) use (&$completedMap): void {
                    if (array_key_exists($row->d, $completedMap)) {
                        $completedMap[$row->d] = (int) $row->c;
                    }
                });

            return [array_values($placedMap), array_values($completedMap), AdminChartData::labels($placedMap, $days)];
        });

        return [
            'datasets' => [
                [
                    'label' => 'Placed',
                    'data' => $placed,
                    'backgroundColor' => 'rgba(37, 99, 235, 0.55)',
                    'borderRadius' => 4,
                ],
                [
                    'label' => 'Completed',
                    'data' => $completed,
                    'backgroundColor' => 'rgba(16, 185, 129, 0.75)',
                    'borderRadius' => 4,
                ],
            ],
            'labels' => $labels,
        ];
    }

    protected function getType(): string
    {
        return 'bar';
    }

    protected function getOptions(): RawJs
    {
        return RawJs::make(<<<'JS'
            {
                maintainAspectRatio: false,
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
