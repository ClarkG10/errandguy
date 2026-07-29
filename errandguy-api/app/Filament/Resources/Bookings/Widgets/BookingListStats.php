<?php

namespace App\Filament\Resources\Bookings\Widgets;

use App\Models\Booking;
use App\Support\AdminCache;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

/** Compact stats strip shown above the Bookings list (resource-scoped, not on the dashboard). */
class BookingListStats extends StatsOverviewWidget
{
    protected ?string $pollingInterval = '60s';

    protected int|array|null $columns = 4;

    protected function getStats(): array
    {
        $d = AdminCache::remember('admin:list:bookings-stats', function (): array {
            $today = today();
            $tomorrow = today()->addDay();

            return [
                'today' => Booking::where('created_at', '>=', $today)->count(),
                'active' => Booking::whereNotIn('status', ['completed', 'cancelled', 'no_runner'])->count(),
                'gmv_today' => (float) Booking::where('status', 'completed')->where('completed_at', '>=', $today)->where('completed_at', '<', $tomorrow)->sum('total_amount'),
                'completed_today' => Booking::where('status', 'completed')->where('completed_at', '>=', $today)->where('completed_at', '<', $tomorrow)->count(),
            ];
        });

        return [
            Stat::make('Placed today', number_format($d['today']))->color('primary')->descriptionIcon('heroicon-m-plus-circle'),
            Stat::make('Active now', number_format($d['active']))->color('info')->descriptionIcon('heroicon-m-bolt'),
            Stat::make('GMV today', '₱'.number_format($d['gmv_today'], 2))->color('success')->descriptionIcon('heroicon-m-banknotes'),
            Stat::make('Completed today', number_format($d['completed_today']))->color('success')->descriptionIcon('heroicon-m-check-circle'),
        ];
    }
}
