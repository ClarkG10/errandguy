<?php

namespace App\Filament\Resources\SavedAddresses\Tables;

use Filament\Actions\ViewAction;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;

class SavedAddressesTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('user.full_name')->label('User')->searchable(),
                TextColumn::make('label')->searchable(),
                TextColumn::make('address')->limit(50)->searchable()->wrap(),
                IconColumn::make('is_default')->boolean(),
                TextColumn::make('created_at')->dateTime()->since()->toggleable(),
            ])
            ->filters([
                TernaryFilter::make('is_default')->label('Default'),
            ])
            ->recordActions([
                ViewAction::make(),
            ]);
    }
}
