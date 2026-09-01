<?php

namespace App\Filament\Resources\SupportTickets\Pages;

use App\Filament\Resources\SupportTickets\SupportTicketResource;
use App\Filament\Support\ListTabs;
use App\Models\SupportTicket;
use App\Support\AdminCache;
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
            // The queue that actually gates users: an agent reply sets the
            // ticket to 'pending', and the customer's answer leaves it there —
            // so a replied-to ticket used to be indistinguishable from one
            // genuinely awaiting the user, and the only way to tell was to open
            // every pending ticket. Oldest-unanswered first, the same SLA idiom
            // as the dispute and KYC queues (the asc clause lands on the base
            // query ahead of the table's last_message_at,desc default and, being
            // the first orderBy on that column, wins). Its own 60s cached count
            // — ListTabs::counts only groups by status, which is precisely the
            // column that cannot answer this.
            'awaiting' => Tab::make('Waiting on us')->icon('heroicon-m-inbox-arrow-down')->badgeColor('danger')
                ->badge(AdminCache::rememberFor(
                    'admin:tabs:support-awaiting',
                    60,
                    fn (): int => SupportTicket::needsReply()->count(),
                ))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query
                    ->needsReply()
                    ->orderBy('last_message_at', 'asc')),
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
