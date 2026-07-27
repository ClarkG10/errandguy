<?php

namespace App\Filament\Resources\Notifications\Tables;

use Filament\Actions\ViewAction;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;

class NotificationsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('created_at')
                    ->dateTime()
                    ->sortable(),
                TextColumn::make('user.full_name')
                    ->searchable(),
                TextColumn::make('title')
                    ->searchable()
                    ->limit(40),
                TextColumn::make('type')
                    ->badge(),
                IconColumn::make('is_read')
                    ->boolean(),
                TextColumn::make('body')
                    ->limit(60)
                    ->toggleable(),
            ])
            ->filters([
                SelectFilter::make('type')
                    ->options(fn (): array => \App\Models\Notification::query()
                        ->select('type')
                        ->distinct()
                        ->orderBy('type')
                        ->pluck('type', 'type')
                        ->all()),
                TernaryFilter::make('is_read')
                    ->label('Read'),
            ])
            ->recordActions([
                ViewAction::make(),
            ]);
    }
}
