<?php

namespace App\Filament\Widgets;

use App\Filament\Pages\Payouts;
use App\Filament\Resources\Bookings\BookingResource;
use App\Filament\Resources\DisputeTickets\DisputeTicketResource;
use App\Filament\Resources\RunnerProfiles\RunnerProfileResource;
use App\Filament\Resources\SOSAlerts\SOSAlertResource;
use App\Models\Booking;
use App\Models\DisputeTicket;
use App\Models\RunnerProfile;
use App\Models\SOSAlert;
use App\Models\WalletTransaction;
use App\Support\AdminCache;
use Illuminate\Support\Carbon;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

/**
 * "Needs attention" queue — the things an operator must act on, each a
 * clickable card that deep-links straight into the relevant filtered list.
 * Active SOS is always first and red because it is a life-safety signal.
 *
 * Each queue also carries the age of its oldest waiting item so a small-but-old
 * backlog (e.g. one dispute untouched for a day) still reads as urgent, with
 * amber/red escalation once it passes that queue's SLA.
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
        $d = AdminCache::remember(AdminCache::QUEUE, function (): array {
            // Bookings the flow has terminally stalled on: the match search ran
            // out and no runner could be found. (Pending/matched offers past the
            // acceptance SLA are transient — the ExpireStaleMatchesJob sweep
            // resolves them to no_runner or a re-match within seconds — so they
            // are deliberately NOT counted here, which also keeps this card's
            // number consistent with the no_runner list its tap deep-links to.)
            $stuckQuery = fn () => Booking::where('status', 'no_runner');

            return [
                'sos' => SOSAlert::where('status', 'active')->count(),
                'sos_oldest' => SOSAlert::where('status', 'active')->min('triggered_at'),
                'verifications' => RunnerProfile::where('verification_status', 'pending')->count(),
                'verifications_oldest' => RunnerProfile::where('verification_status', 'pending')->min('created_at'),
                'disputes' => DisputeTicket::unresolved()->count(),
                'disputes_oldest' => DisputeTicket::unresolved()->min('created_at'),
                'payouts' => WalletTransaction::where('type', 'payout')->where('status', 'pending')->count(),
                'payouts_oldest' => WalletTransaction::where('type', 'payout')->where('status', 'pending')->min('created_at'),
                'stuck' => $stuckQuery()->count(),
                'stuck_oldest' => $stuckQuery()->min('created_at'),
            ];
        });

        return [
            Stat::make('Active SOS', number_format($d['sos']))
                ->description($this->withAge($d['sos'] > 0 ? 'Life-safety — respond now' : 'All clear', $d['sos_oldest']))
                ->descriptionIcon('heroicon-m-shield-exclamation')
                ->color($d['sos'] > 0 ? 'danger' : 'gray')
                ->url(SOSAlertResource::getUrl('index', ['tableFilters' => ['status' => ['value' => 'active']]])),

            Stat::make('Stuck errands', number_format($d['stuck']))
                ->description($this->withAge($d['stuck'] > 0 ? 'No runner could be assigned' : 'All flowing', $d['stuck_oldest']))
                ->descriptionIcon('heroicon-m-exclamation-triangle')
                ->color($d['stuck'] > 0 ? 'danger' : 'gray')
                ->url(BookingResource::getUrl('index', ['tableFilters' => ['status' => ['value' => 'no_runner']]])),

            Stat::make('Pending verifications', number_format($d['verifications']))
                ->description($this->withAge($d['verifications'] > 0 ? 'Runners awaiting approval' : 'Nothing waiting', $d['verifications_oldest']))
                ->descriptionIcon('heroicon-m-identification')
                ->color($this->escalate($d['verifications_oldest'], $d['verifications'] > 0 ? 'warning' : 'gray', 1440, 2880))
                ->url(RunnerProfileResource::getUrl('index', ['tableFilters' => ['verification_status' => ['value' => 'pending']]])),

            Stat::make('Open disputes', number_format($d['disputes']))
                ->description($this->withAge($d['disputes'] > 0 ? 'Awaiting resolution' : 'No open disputes', $d['disputes_oldest']))
                ->descriptionIcon('heroicon-m-scale')
                ->color($this->escalate($d['disputes_oldest'], $d['disputes'] > 0 ? 'warning' : 'gray', 240, 1440))
                ->url(DisputeTicketResource::getUrl('index', ['tableFilters' => ['status' => ['value' => 'open']]])),

            Stat::make('Pending payouts', number_format($d['payouts']))
                ->description($this->withAge($d['payouts'] > 0 ? 'Awaiting disbursement' : 'Nothing pending', $d['payouts_oldest']))
                ->descriptionIcon('heroicon-m-banknotes')
                ->color($this->escalate($d['payouts_oldest'], $d['payouts'] > 0 ? 'primary' : 'gray', 720, 2880))
                ->url(Payouts::getUrl()),
        ];
    }

    /**
     * Append the age of the oldest waiting item to a stat's description, e.g.
     * "Awaiting resolution · Oldest 12 minutes ago".
     */
    private function withAge(string $base, ?string $oldest): string
    {
        if ($oldest === null) {
            return $base;
        }

        return $base.' · Oldest '.Carbon::parse($oldest)->diffForHumans();
    }

    /**
     * Escalate a stat's colour once its oldest item passes the queue's SLA:
     * amber ('warning') past $warnMinutes, red ('danger') past $dangerMinutes.
     * Falls back to the base colour when the queue is empty or still fresh.
     */
    private function escalate(?string $oldest, string $base, int $warnMinutes, int $dangerMinutes): string
    {
        if ($oldest === null) {
            return $base;
        }

        $ageMinutes = Carbon::parse($oldest)->diffInMinutes(now());

        return match (true) {
            $ageMinutes >= $dangerMinutes => 'danger',
            $ageMinutes >= $warnMinutes => 'warning',
            default => $base,
        };
    }
}
