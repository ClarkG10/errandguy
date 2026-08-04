<?php

namespace App\Filament\Widgets;

use App\Filament\Resources\Bookings\BookingResource;
use App\Models\Booking;
use App\Support\AdminCache;
use Filament\Support\RawJs;
use Filament\Widgets\ChartWidget;

/**
 * Live pipeline: in-flight bookings broken down by their current status, so ops
 * can see where work is piling up (e.g. many "matched" but few "picked_up").
 * Auto-refreshes and each segment deep-links into that status-filtered list.
 */
class BookingStatusChart extends ChartWidget
{
    protected static ?int $sort = 4;

    protected ?string $pollingInterval = '30s';

    protected ?string $heading = 'Live pipeline';

    protected ?string $description = 'In-flight bookings by current status — click a segment to open that filtered list.';

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
        // Map each human label to its status-filtered Bookings list, matching the
        // tableFilters deep-link idiom used by the ActionQueue widget. Keyed by
        // label so it stays correct regardless of which zero-count segments the
        // dataset drops; the empty-state label simply has no entry (no-op click).
        //
        // Built as a SINGLE-QUOTED JS object literal on purpose. Filament renders
        // getOptions() straight into a DOUBLE-quoted HTML attribute on the chart
        // canvas — so a double quote in here (as json_encode emits) closes that
        // attribute early and dumps the raw Chart.js config onto the page (the
        // "Live pipeline" text-blob bug). Single quotes are safe inside it, which
        // is why the all-single-quoted PaymentMixChart options render fine.
        $pairs = [];
        foreach (self::STATUSES as $status => [$label]) {
            $url = BookingResource::getUrl('index', ['tableFilters' => ['status' => ['value' => $status]]]);
            $key = addcslashes($label, "\\'");
            $val = addcslashes($url, "\\'");
            $pairs[] = "'{$key}': '{$val}'";
        }
        $urlsJs = '{ '.implode(', ', $pairs).' }';

        // Chart.js onClick is the click mechanism Filament v4's ChartWidget
        // exposes (options are passed straight into the Chart config). Filament has
        // no first-class segment-click-to-navigate API in this version, so we
        // navigate directly.
        return RawJs::make(<<<JS
            {
                maintainAspectRatio: false,
                cutout: '62%',
                onClick: (event, elements, chart) => {
                    if (! elements.length) { return; }
                    const label = chart.data.labels[elements[0].index];
                    const urls = {$urlsJs};
                    if (urls[label]) { window.location.href = urls[label]; }
                },
                onHover: (event, elements) => {
                    event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
                },
                plugins: {
                    legend: { display: true, position: 'right', labels: { usePointStyle: true, boxWidth: 8, padding: 10 } },
                },
            }
        JS);
    }
}
