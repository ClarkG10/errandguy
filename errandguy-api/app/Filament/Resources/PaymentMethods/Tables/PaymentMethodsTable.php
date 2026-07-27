<?php

namespace App\Filament\Resources\PaymentMethods\Tables;

use Filament\Actions\ViewAction;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class PaymentMethodsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('user.full_name')
                    ->searchable(),
                TextColumn::make('type')
                    ->badge(),
                TextColumn::make('card_brand')
                    ->toggleable(),
                TextColumn::make('last_four')
                    ->label('Card')
                    ->prefix('•••• ')
                    ->placeholder('—'),
                TextColumn::make('channel_code')
                    ->toggleable(),
                TextColumn::make('status')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'active' => 'success',
                        'pending' => 'warning',
                        'failed', 'expired' => 'danger',
                        default => 'gray',
                    }),
                IconColumn::make('is_default')
                    ->boolean(),
                TextColumn::make('expires_at')
                    ->date()
                    ->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                SelectFilter::make('type')
                    ->options([
                        'card' => 'Card',
                        'gcash' => 'GCash',
                        'maya' => 'Maya',
                    ]),
                SelectFilter::make('status')
                    ->options([
                        'pending' => 'Pending',
                        'active' => 'Active',
                        'failed' => 'Failed',
                        'expired' => 'Expired',
                    ]),
            ])
            ->recordActions([
                ViewAction::make(),
            ]);
    }
}
