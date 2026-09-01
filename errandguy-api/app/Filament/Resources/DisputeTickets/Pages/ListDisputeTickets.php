<?php

namespace App\Filament\Resources\DisputeTickets\Pages;

use App\Filament\Resources\DisputeTickets\DisputeTicketResource;
use App\Filament\Support\ListTabs;
use App\Models\DisputeTicket;
use Filament\Resources\Pages\ListRecords;
use Filament\Schemas\Components\Tabs\Tab;
use Illuminate\Database\Eloquent\Builder;

class ListDisputeTickets extends ListRecords
{
    protected static string $resource = DisputeTicketResource::class;

    public function getTabs(): array
    {
        $c = ListTabs::counts('disputes', DisputeTicket::class, 'status');

        return [
            'all' => Tab::make('All')->badge(array_sum($c)),
            // The dashboard's "Open disputes" card counts every UNRESOLVED
            // dispute (open + reviewing + escalated) — this tab is the list
            // that count actually corresponds to, so the card can deep-link
            // somewhere that shows the same number it displays. Oldest first,
            // like the other work queues.
            'unresolved' => Tab::make('Unresolved')->icon('heroicon-m-inbox-stack')->badgeColor('warning')
                ->badge(ListTabs::sum($c, 'open') + ListTabs::sum($c, 'reviewing') + ListTabs::sum($c, 'escalated'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query
                    ->unresolved()
                    ->orderBy('created_at', 'asc')),
            // SLA queues: oldest first, so the customer who has been waiting
            // three days is on top instead of the last page. Same idiom as the
            // KYC pending tab (ListRunnerProfiles) — the asc clause is applied
            // to the base query ahead of the table's created_at,desc default
            // and, being the first orderBy on that column, wins.
            'open' => Tab::make('Open')->icon('heroicon-m-exclamation-circle')->badgeColor('warning')
                ->badge(ListTabs::sum($c, 'open'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query
                    ->where('status', 'open')
                    ->orderBy('created_at', 'asc')),
            'reviewing' => Tab::make('Reviewing')->icon('heroicon-m-magnifying-glass')->badgeColor('info')
                ->badge(ListTabs::sum($c, 'reviewing'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query
                    ->where('status', 'reviewing')
                    ->orderBy('created_at', 'asc')),
            'escalated' => Tab::make('Escalated')->icon('heroicon-m-arrow-trending-up')->badgeColor('danger')
                ->badge(ListTabs::sum($c, 'escalated'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query
                    ->where('status', 'escalated')
                    ->orderBy('created_at', 'asc')),
            'resolved' => Tab::make('Resolved')->icon('heroicon-m-check-circle')->badgeColor('success')
                ->badge(ListTabs::sum($c, 'resolved'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('status', 'resolved')),
        ];
    }
}
