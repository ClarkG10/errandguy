<?php

namespace App\Filament\Resources\Payments\Widgets;

use App\Models\Payment;
use App\Support\AdminCache;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

/** Compact stats strip shown above the Payments list (resource-scoped, not on the dashboard). */
class PaymentListStats extends StatsOverviewWidget
{
    protected ?string $pollingInterval = '60s';

    protected int|array|null $columns = 4;

    protected function getStats(): array
    {
        $d = AdminCache::remember('admin:list:payments-stats', function (): array {
            $today = today();
            $tomorrow = today()->addDay();
            $since = today()->subDays(30);

            return [
                'completed_today' => (float) Payment::where('status', 'completed')->where('paid_at', '>=', $today)->where('paid_at', '<', $tomorrow)->sum('amount'),
                'pending' => Payment::whereIn('status', ['pending', 'processing'])->count(),
                'refunded_30d' => (float) Payment::where('status', 'refunded')->where('created_at', '>=', $since)->sum('refund_amount'),
                'failed_today' => Payment::whereIn('status', ['failed', 'expired'])->where('created_at', '>=', $today)->count(),
            ];
        });

        return [
            Stat::make('Collected today', '₱'.number_format($d['completed_today'], 2))->color('success')->descriptionIcon('heroicon-m-check-circle'),
            Stat::make('Pending', number_format($d['pending']))->color($d['pending'] > 0 ? 'warning' : 'gray')->descriptionIcon('heroicon-m-clock'),
            Stat::make('Refunded (30d)', '₱'.number_format($d['refunded_30d'], 2))->color('info')->descriptionIcon('heroicon-m-arrow-uturn-left'),
            Stat::make('Failed today', number_format($d['failed_today']))->color($d['failed_today'] > 0 ? 'danger' : 'gray')->descriptionIcon('heroicon-m-x-circle'),
        ];
    }
}
