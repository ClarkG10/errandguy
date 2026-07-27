<?php

namespace App\Filament\Resources\SystemConfigs\Tables;

use Filament\Actions\EditAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class SystemConfigsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('key')
            ->columns([
                TextColumn::make('key')
                    ->searchable()
                    ->sortable(),
                TextColumn::make('value')
                    ->limit(60),
                TextColumn::make('description')
                    ->limit(60)
                    ->toggleable(),
                TextColumn::make('updated_at')
                    ->dateTime(),
            ])
            ->recordActions([
                EditAction::make(),
            ]);
    }
}
