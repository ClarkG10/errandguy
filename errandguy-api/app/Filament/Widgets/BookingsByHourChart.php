<?php

namespace App\Filament\Widgets;

use App\Models\Booking;
use App\Support\AdminCache;
use App\Support\AdminChartData;
use Filament\Support\RawJs;
use Filament\Widgets\ChartWidget;

/**
 * When do bookings happen? Count by hour-of-day (Manila time) over the last
 * 30 days — surfaces peak demand windows for staffing / incentives.
 */
class BookingsByHourChart extends ChartWidget
{
    protected static ?int $sort = 11;

    protected ?string $heading = 'Peak hours';

    protected ?string $description = 'Bookings by hour of day (PHT), last 30 days.';

    protected int|string|array $columnSpan = 'full';

    protected ?string $maxHeight = '240px';

    protected function getData(): array
    {
        $counts = AdminCache::rememberFor(AdminCache::CHART_BOOKINGS.':by-hour', 300, fn (): array => Booking::query()
            ->where('created_at', '>=', today()->subDays(30))
            ->selectRaw(AdminChartData::manilaHour('created_at').' as h, count(*) as c')
            ->groupBy('h')
            ->pluck('c', 'h')
            ->all());

        $data = [];
        $labels = [];
        for ($h = 0; $h < 24; $h++) {
            $data[] = (int) ($counts[$h] ?? 0);
            $labels[] = str_pad((string) $h, 2, '0', STR_PAD_LEFT).'h';
        }

        return [
            'datasets' => [[
                'label' => 'Bookings',
                'data' => $data,
                'backgroundColor' => 'rgba(37, 99, 235, 0.55)',
                'borderRadius' => 4,
            ]],
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
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(148,163,184,0.15)' } },
                    x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
                },
            }
        JS);
    }
}
