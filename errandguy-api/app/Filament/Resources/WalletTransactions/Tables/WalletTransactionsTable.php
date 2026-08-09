<?php

namespace App\Filament\Resources\WalletTransactions\Tables;

use App\Filament\Support\DateRangeFilter;
use App\Filament\Support\ExportCsv;
use App\Models\WalletTransaction;
use Filament\Actions\ViewAction;
use Filament\Tables\Columns\Summarizers\Sum;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class WalletTransactionsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('user.full_name')
                    ->searchable(),
                TextColumn::make('type')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'top_up', 'earning', 'bonus' => 'success',
                        'refund' => 'info',
                        'payout', 'payment' => 'warning',
                        default => 'gray',
                    }),
                TextColumn::make('amount')
                    ->money('PHP')
                    ->sortable()
                    // Negative amounts read as debits against the wallet.
                    ->color(fn ($state): string => (float) $state < 0 ? 'danger' : 'success')
                    ->summarize(Sum::make()->money('PHP')->label('Net')),
                TextColumn::make('balance_after')
                    ->money('PHP')
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('status')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'completed' => 'success',
                        'pending' => 'warning',
                        'failed' => 'danger',
                        'reversed' => 'gray',
                        default => 'gray',
                    }),
                TextColumn::make('description')
                    ->limit(40)
                    ->toggleable(),
                TextColumn::make('reference_id')
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('created_at')
                    ->dateTime()
                    ->sortable(),
            ])
            ->filters([
                SelectFilter::make('type')
                    ->options([
                        'top_up' => 'Top-up',
                        'payout' => 'Payout',
                        'earning' => 'Earning',
                        'payment' => 'Payment',
                        'refund' => 'Refund',
                        'bonus' => 'Bonus',
                    ]),
                SelectFilter::make('status')
                    ->options([
                        'completed' => 'Completed',
                        'pending' => 'Pending',
                        'failed' => 'Failed',
                        'reversed' => 'Reversed',
                    ]),
                DateRangeFilter::make('created_at', 'Date'),
            ])
            ->headerActions([
                ExportCsv::make('wallet-transactions', [
                    'User' => fn (WalletTransaction $r): ?string => $r->user?->full_name,
                    'Type' => fn (WalletTransaction $r): ?string => $r->type,
                    'Amount (PHP)' => fn (WalletTransaction $r) => $r->amount,
                    'Balance after (PHP)' => fn (WalletTransaction $r) => $r->balance_after,
                    'Status' => fn (WalletTransaction $r): ?string => $r->status,
                    'Description' => fn (WalletTransaction $r): ?string => $r->description,
                    'Reference' => fn (WalletTransaction $r): ?string => $r->reference_id,
                    'Created' => fn (WalletTransaction $r) => $r->created_at,
                ]),
            ])
            ->recordActions([
                ViewAction::make(),
            ]);
    }
}
