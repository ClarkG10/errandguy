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
            'open' => Tab::make('Open')->icon('heroicon-m-exclamation-circle')->badgeColor('warning')
                ->badge(ListTabs::sum($c, 'open'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('status', 'open')),
            'reviewing' => Tab::make('Reviewing')->icon('heroicon-m-magnifying-glass')->badgeColor('info')
                ->badge(ListTabs::sum($c, 'reviewing'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('status', 'reviewing')),
            'escalated' => Tab::make('Escalated')->icon('heroicon-m-arrow-trending-up')->badgeColor('danger')
                ->badge(ListTabs::sum($c, 'escalated'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('status', 'escalated')),
            'resolved' => Tab::make('Resolved')->icon('heroicon-m-check-circle')->badgeColor('success')
                ->badge(ListTabs::sum($c, 'resolved'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('status', 'resolved')),
        ];
    }
}
