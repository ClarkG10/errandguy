<?php

namespace App\Filament\Widgets;

use App\Models\Booking;
use App\Support\AdminCache;
use App\Support\AdminChartData;
use Filament\Support\RawJs;
use Filament\Widgets\ChartWidget;

/**
 * How customers pay: share of completed-booking GMV by payment method
 * over the selected window.
 */
class PaymentMixChart extends ChartWidget
{
    protected static ?int $sort = 6;

    protected ?string $heading = 'Payment mix';

    protected ?string $description = 'Completed-booking value by payment method.';

    protected int|string|array $columnSpan = ['default' => 'full', 'lg' => 2];

    protected ?string $maxHeight = '280px';

    public ?string $filter = '30';

    /** method => [label, hex] */
    private const METHODS = [
        'wallet' => ['Wallet', '#2563eb'],
        'gcash' => ['GCash', '#0ea5e9'],
        'maya' => ['Maya', '#10b981'],
        'card' => ['Card', '#8b5cf6'],
        'cash' => ['Cash', '#ea580c'],
    ];

    protected function getFilters(): ?array
    {
        return ['7' => 'Last 7 days', '30' => 'Last 30 days', '90' => 'Last 90 days'];
    }

    protected function getData(): array
    {
        $days = (int) $this->filter;

        $totals = AdminCache::rememberFor(AdminCache::CHART_PAYMENT_MIX.':'.$days, 300, fn (): array => Booking::query()
            ->where('status', 'completed')
            ->where('completed_at', '>=', AdminChartData::since($days))
            ->selectRaw('payment_method, sum(total_amount) as v')
            ->groupBy('payment_method')
            ->pluck('v', 'payment_method')
            ->all());

        $labels = [];
        $data = [];
        $colors = [];
        foreach (self::METHODS as $method => [$label, $hex]) {
            $v = (float) ($totals[$method] ?? 0);
            if ($v <= 0) {
                continue;
            }
            $labels[] = $label;
            $data[] = round($v, 2);
            $colors[] = $hex;
        }

        if ($data === []) {
            $labels = ['No completed bookings'];
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
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ctx.label + ': ₱' + Number(ctx.parsed).toLocaleString('en-PH', { minimumFractionDigits: 2 }),
                        },
                    },
                },
            }
        JS);
    }
}
