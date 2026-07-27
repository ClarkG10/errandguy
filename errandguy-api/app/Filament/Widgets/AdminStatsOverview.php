<?php

namespace App\Filament\Widgets;

use App\Models\Booking;
use App\Models\DisputeTicket;
use App\Models\RunnerProfile;
use App\Models\SOSAlert;
use App\Models\User;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

class AdminStatsOverview extends StatsOverviewWidget
{
    protected ?string $pollingInterval = '30s';

    protected function getStats(): array
    {
        $todayStart = today();
        $tomorrowStart = today()->addDay();

        $gmvToday = (float) Booking::where('status', 'completed')
            ->where('completed_at', '>=', $todayStart)
            ->where('completed_at', '<', $tomorrowStart)
            ->sum('total_amount');

        $activeBookings = Booking::whereNotIn('status', ['completed', 'cancelled', 'no_runner'])->count();
        $pendingVerifications = RunnerProfile::where('verification_status', 'pending')->count();
        $openDisputes = DisputeTicket::whereIn('status', ['open', 'reviewing'])->count();
        $activeSos = SOSAlert::where('status', 'active')->count();

        return [
            Stat::make('Customers', number_format(User::where('role', 'customer')->count()))
                ->description('Runners: ' . number_format(User::where('role', 'runner')->count()))
                ->color('primary'),
            Stat::make('Active bookings', number_format($activeBookings))
                ->description('In flight right now')
                ->color('info'),
            Stat::make('GMV today', '₱' . number_format($gmvToday, 2))
                ->description('Completed bookings today')
                ->color('success'),
            Stat::make('Pending verifications', number_format($pendingVerifications))
                ->description('Runners awaiting approval')
                ->color($pendingVerifications > 0 ? 'warning' : 'gray'),
            Stat::make('Open disputes', number_format($openDisputes))
                ->color($openDisputes > 0 ? 'warning' : 'gray'),
            Stat::make('Active SOS', number_format($activeSos))
                ->description($activeSos > 0 ? 'Needs attention' : 'All clear')
                ->color($activeSos > 0 ? 'danger' : 'gray'),
        ];
    }
}
