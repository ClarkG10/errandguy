<?php

namespace App\Filament\Widgets;

use App\Filament\Pages\Payouts;
use App\Filament\Resources\DisputeTickets\DisputeTicketResource;
use App\Filament\Resources\RunnerProfiles\RunnerProfileResource;
use App\Filament\Resources\SOSAlerts\SOSAlertResource;
use App\Models\DisputeTicket;
use App\Models\RunnerProfile;
use App\Models\SOSAlert;
use App\Models\WalletTransaction;
use App\Support\AdminCache;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

/**
 * "Needs attention" queue — the four things an operator must act on, each a
 * clickable card that deep-links straight into the relevant filtered list.
 * Active SOS is always first and red because it is a life-safety signal.
 */
class ActionQueue extends StatsOverviewWidget
{
    protected static ?int $sort = 2;

    protected ?string $pollingInterval = '30s';

    protected int|string|array $columnSpan = 'full';

    protected int|array|null $columns = 4;

    protected ?string $heading = 'Needs attention';

    protected ?string $description = 'Live operational queues — click a card to jump straight to it.';

    protected function getStats(): array
    {
        $d = AdminCache::remember(AdminCache::QUEUE, fn (): array => [
            'sos' => SOSAlert::where('status', 'active')->count(),
            'verifications' => RunnerProfile::where('verification_status', 'pending')->count(),
            'disputes' => DisputeTicket::whereIn('status', ['open', 'reviewing'])->count(),
            'payouts' => WalletTransaction::where('type', 'payout')->where('status', 'pending')->count(),
        ]);

        return [
            Stat::make('Active SOS', number_format($d['sos']))
                ->description($d['sos'] > 0 ? 'Life-safety — respond now' : 'All clear')
                ->descriptionIcon('heroicon-m-shield-exclamation')
                ->color($d['sos'] > 0 ? 'danger' : 'gray')
                ->url(SOSAlertResource::getUrl('index', ['tableFilters' => ['status' => ['value' => 'active']]])),

            Stat::make('Pending verifications', number_format($d['verifications']))
                ->description($d['verifications'] > 0 ? 'Runners awaiting approval' : 'Nothing waiting')
                ->descriptionIcon('heroicon-m-identification')
                ->color($d['verifications'] > 0 ? 'warning' : 'gray')
                ->url(RunnerProfileResource::getUrl('index', ['tableFilters' => ['verification_status' => ['value' => 'pending']]])),

            Stat::make('Open disputes', number_format($d['disputes']))
                ->description($d['disputes'] > 0 ? 'Awaiting resolution' : 'No open disputes')
                ->descriptionIcon('heroicon-m-scale')
                ->color($d['disputes'] > 0 ? 'warning' : 'gray')
                ->url(DisputeTicketResource::getUrl('index', ['tableFilters' => ['status' => ['value' => 'open']]])),

            Stat::make('Pending payouts', number_format($d['payouts']))
                ->description($d['payouts'] > 0 ? 'Awaiting disbursement' : 'Nothing pending')
                ->descriptionIcon('heroicon-m-banknotes')
                ->color($d['payouts'] > 0 ? 'primary' : 'gray')
                ->url(Payouts::getUrl()),
        ];
    }
}
