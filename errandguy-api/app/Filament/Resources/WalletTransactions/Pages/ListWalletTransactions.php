<?php

namespace App\Filament\Resources\WalletTransactions\Pages;

use App\Filament\Resources\WalletTransactions\WalletTransactionResource;
use App\Filament\Support\ListTabs;
use App\Models\WalletTransaction;
use Filament\Resources\Pages\ListRecords;
use Filament\Schemas\Components\Tabs\Tab;
use Illuminate\Database\Eloquent\Builder;

class ListWalletTransactions extends ListRecords
{
    protected static string $resource = WalletTransactionResource::class;

    public function getTabs(): array
    {
        $c = ListTabs::counts('wallet_type', WalletTransaction::class, 'type');

        return [
            'all' => Tab::make('All')->badge(array_sum($c)),
            'topups' => Tab::make('Top-ups')->icon('heroicon-m-arrow-down-circle')->badgeColor('success')
                ->badge(ListTabs::sum($c, 'top_up'))
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->where('type', 'top_up')),
            'payouts' => Tab::make('Payouts')->icon('heroicon-m-arrow-up-circle')->badgeColor('warning')
                ->badge(ListTabs::sum($c, 'payout'))
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->where('type', 'payout')),
            'earnings' => Tab::make('Earnings')->icon('heroicon-m-banknotes')->badgeColor('info')
                ->badge(ListTabs::sum($c, 'earning'))
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->where('type', 'earning')),
            'refunds' => Tab::make('Refunds')->icon('heroicon-m-arrow-uturn-left')->badgeColor('gray')
                ->badge(ListTabs::sum($c, 'refund'))
                ->modifyQueryUsing(fn (Builder $q): Builder => $q->where('type', 'refund')),
        ];
    }
}
