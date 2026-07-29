<?php

namespace App\Filament\Resources\Payments\Pages;

use App\Filament\Resources\Payments\PaymentResource;
use App\Filament\Support\ListTabs;
use App\Models\Payment;
use Filament\Resources\Pages\ListRecords;
use Filament\Schemas\Components\Tabs\Tab;
use Illuminate\Database\Eloquent\Builder;

class ListPayments extends ListRecords
{
    protected static string $resource = PaymentResource::class;

    public function getTabs(): array
    {
        $c = ListTabs::counts('payments', Payment::class, 'status');

        return [
            'all' => Tab::make('All')->badge(array_sum($c)),
            'completed' => Tab::make('Completed')->icon('heroicon-m-check-circle')->badgeColor('success')
                ->badge(ListTabs::sum($c, 'completed'))
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->where('status', 'completed')),
            'pending' => Tab::make('Pending')->icon('heroicon-m-clock')->badgeColor('warning')
                ->badge(ListTabs::sum($c, 'pending', 'processing'))
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->whereIn('status', ['pending', 'processing'])),
            'refunded' => Tab::make('Refunded')->icon('heroicon-m-arrow-uturn-left')->badgeColor('info')
                ->badge(ListTabs::sum($c, 'refunded'))
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->where('status', 'refunded')),
            'failed' => Tab::make('Failed')->icon('heroicon-m-x-circle')->badgeColor('danger')
                ->badge(ListTabs::sum($c, 'failed', 'cancelled', 'expired'))
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->whereIn('status', ['failed', 'cancelled', 'expired'])),
        ];
    }
}
