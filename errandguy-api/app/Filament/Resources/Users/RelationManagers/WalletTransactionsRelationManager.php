<?php

namespace App\Filament\Resources\Users\RelationManagers;

use Filament\Resources\RelationManagers\RelationManager;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class WalletTransactionsRelationManager extends RelationManager
{
    protected static string $relationship = 'walletTransactions';

    protected static ?string $title = 'Wallet history';

    protected static string|\BackedEnum|null $icon = 'heroicon-m-wallet';

    public function table(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->paginated([10, 25])
            ->columns([
                TextColumn::make('type')->badge()->color(fn (string $s): string => match ($s) {
                    'top_up', 'earning', 'bonus' => 'success',
                    'refund' => 'info',
                    'payout', 'payment' => 'warning',
                    default => 'gray',
                }),
                TextColumn::make('amount')->money('PHP')
                    ->color(fn ($state): string => (float) $state < 0 ? 'danger' : 'success')->alignEnd(),
                TextColumn::make('balance_after')->label('Balance')->money('PHP')->alignEnd(),
                TextColumn::make('status')->badge()->color(fn (string $s): string => match ($s) {
                    'completed' => 'success', 'pending' => 'warning', 'failed' => 'danger', default => 'gray',
                }),
                TextColumn::make('description')->limit(40)->toggleable(),
                TextColumn::make('created_at')->since()->dateTimeTooltip()->alignEnd(),
            ])
            ->filters([
                SelectFilter::make('type')->options([
                    'top_up' => 'Top-up', 'payout' => 'Payout', 'earning' => 'Earning',
                    'payment' => 'Payment', 'refund' => 'Refund',
                ]),
            ]);
    }
}
