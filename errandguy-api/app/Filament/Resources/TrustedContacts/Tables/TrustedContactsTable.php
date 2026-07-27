<?php

namespace App\Filament\Resources\TrustedContacts\Tables;

use Filament\Actions\ViewAction;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;

class TrustedContactsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('priority')
            ->columns([
                TextColumn::make('user.full_name')->label('User')->searchable()->sortable(),
                TextColumn::make('name')->searchable(),
                TextColumn::make('phone'),
                TextColumn::make('relationship'),
                TextColumn::make('priority')->sortable(),
                IconColumn::make('is_active')->boolean(),
            ])
            ->filters([
                TernaryFilter::make('is_active'),
            ])
            ->recordActions([
                ViewAction::make(),
            ]);
    }
}
