<?php

namespace App\Filament\Resources\SupportTickets\Pages;

use App\Filament\Resources\SupportTickets\SupportTicketResource;
use App\Filament\Support\ListTabs;
use App\Models\SupportTicket;
use Filament\Resources\Pages\ListRecords;
use Filament\Schemas\Components\Tabs\Tab;
use Illuminate\Database\Eloquent\Builder;

class ListSupportTickets extends ListRecords
{
    protected static string $resource = SupportTicketResource::class;

    protected function getHeaderActions(): array
    {
        return [];
    }

    public function getTabs(): array
    {
        $c = ListTabs::counts('support', SupportTicket::class, 'status');

        return [
            'all' => Tab::make('All')->badge(array_sum($c)),
            'open' => Tab::make('Open')->icon('heroicon-m-exclamation-circle')->badgeColor('warning')
                ->badge(ListTabs::sum($c, 'open'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('status', 'open')),
            'pending' => Tab::make('Pending')->icon('heroicon-m-clock')->badgeColor('info')
                ->badge(ListTabs::sum($c, 'pending'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('status', 'pending')),
            'resolved' => Tab::make('Resolved')->icon('heroicon-m-check-circle')->badgeColor('success')
                ->badge(ListTabs::sum($c, 'resolved'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('status', 'resolved')),
            'closed' => Tab::make('Closed')->icon('heroicon-m-x-circle')->badgeColor('gray')
                ->badge(ListTabs::sum($c, 'closed'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('status', 'closed')),
        ];
    }
}
