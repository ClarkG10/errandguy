<?php

namespace App\Filament\Widgets;

use App\Models\Booking;
use App\Models\DisputeTicket;
use App\Models\RunnerProfile;
use App\Models\SOSAlert;
use App\Models\User;
use App\Support\AdminCache;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

class AdminStatsOverview extends StatsOverviewWidget
{
    protected ?string $pollingInterval = '60s';

    protected function getStats(): array
    {
        // All aggregates cached together for 60s (Redis on prod) so the widget
        // doesn't fire ~7 COUNT/SUM queries at the remote DB on every render.
        $d = AdminCache::remember(AdminCache::STATS, function (): array {
            $todayStart = today();
            $tomorrowStart = today()->addDay();

            return [
                'customers' => User::where('role', 'customer')->count(),
                'runners' => User::where('role', 'runner')->count(),
                'active_bookings' => Booking::whereNotIn('status', ['completed', 'cancelled', 'no_runner'])->count(),
                'gmv_today' => (float) Booking::where('status', 'completed')
                    ->where('completed_at', '>=', $todayStart)
                    ->where('completed_at', '<', $tomorrowStart)
                    ->sum('total_amount'),
                'pending_verifications' => RunnerProfile::where('verification_status', 'pending')->count(),
                'open_disputes' => DisputeTicket::whereIn('status', ['open', 'reviewing'])->count(),
                'active_sos' => SOSAlert::where('status', 'active')->count(),
            ];
        });

        return [
            Stat::make('Customers', number_format($d['customers']))
                ->description('Runners: ' . number_format($d['runners']))
                ->color('primary'),
            Stat::make('Active bookings', number_format($d['active_bookings']))
                ->description('In flight right now')
                ->color('info'),
            Stat::make('GMV today', '₱' . number_format($d['gmv_today'], 2))
                ->description('Completed bookings today')
                ->color('success'),
            Stat::make('Pending verifications', number_format($d['pending_verifications']))
                ->description('Runners awaiting approval')
                ->color($d['pending_verifications'] > 0 ? 'warning' : 'gray'),
            Stat::make('Open disputes', number_format($d['open_disputes']))
                ->color($d['open_disputes'] > 0 ? 'warning' : 'gray'),
            Stat::make('Active SOS', number_format($d['active_sos']))
                ->description($d['active_sos'] > 0 ? 'Needs attention' : 'All clear')
                ->color($d['active_sos'] > 0 ? 'danger' : 'gray'),
        ];
    }
}
