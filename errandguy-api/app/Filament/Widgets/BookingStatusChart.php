<?php

namespace App\Filament\Widgets;

use App\Models\Booking;
use App\Support\AdminCache;
use Filament\Support\RawJs;
use Filament\Widgets\ChartWidget;

/**
 * Live pipeline: in-flight bookings broken down by their current status, so ops
 * can see where work is piling up (e.g. many "matched" but few "picked_up").
 */
class BookingStatusChart extends ChartWidget
{
    protected static ?int $sort = 4;

    protected ?string $heading = 'Live pipeline';

    protected ?string $description = 'In-flight bookings by current status.';

    protected int|string|array $columnSpan = ['default' => 'full', 'lg' => 2];

    protected ?string $maxHeight = '280px';

    /** status => [human label, hex] — ordered by how far along the errand is. */
    private const STATUSES = [
        'pending' => ['Pending', '#f59e0b'],
        'matched' => ['Matched', '#3b82f6'],
        'accepted' => ['Accepted', '#2563eb'],
        'heading_to_pickup' => ['Heading to pickup', '#6366f1'],
        'arrived_at_pickup' => ['At pickup', '#8b5cf6'],
        'picked_up' => ['Picked up', '#a855f7'],
        'in_transit' => ['In transit', '#0ea5e9'],
        'arrived_at_dropoff' => ['At dropoff', '#14b8a6'],
        'delivered' => ['Delivered', '#10b981'],
    ];

    protected function getData(): array
    {
        $counts = AdminCache::remember(AdminCache::CHART_STATUS, fn (): array => Booking::query()
            ->whereIn('status', array_keys(self::STATUSES))
            ->selectRaw('status, count(*) as c')
            ->groupBy('status')
            ->pluck('c', 'status')
            ->all());

        $labels = [];
        $data = [];
        $colors = [];
        foreach (self::STATUSES as $status => [$label, $hex]) {
            $n = (int) ($counts[$status] ?? 0);
            if ($n === 0) {
                continue; // keep the doughnut readable — only show live segments
            }
            $labels[] = $label;
            $data[] = $n;
            $colors[] = $hex;
        }

        // Graceful empty state so we never render a broken 0-segment doughnut.
        if ($data === []) {
            $labels = ['No active bookings'];
            $data = [1];
            $colors = ['#e2e8f0'];
        }

        return [
            'datasets' => [[
                'data' => $data,
                'backgroundColor' => $colors,
                'borderWidth' => 0,
                'hoverOffset' => 6,
            ]],
            'labels' => $labels,
        ];
    }

    protected function getType(): string
    {
        return 'doughnut';
    }

    protected function getOptions(): RawJs
    {
        return RawJs::make(<<<'JS'
            {
                maintainAspectRatio: false,
                cutout: '62%',
                plugins: {
                    legend: { display: true, position: 'right', labels: { usePointStyle: true, boxWidth: 8, padding: 10 } },
                },
            }
        JS);
    }
}
