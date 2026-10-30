<?php

namespace App\Filament\Resources\SystemConfigs\Tables;

use App\Models\SystemConfig;
use App\Support\SystemSettings;
use Filament\Actions\EditAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class SystemConfigsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('key')
            // About thirty settings: one page, so search and scanning work.
            ->paginated(false)
            ->columns([
                TextColumn::make('key')
                    ->label('Setting')
                    ->formatStateUsing(fn (string $state): string => SystemSettings::label($state))
                    ->description(fn (SystemConfig $record): string => $record->key)
                    ->searchable()
                    ->sortable(),
                TextColumn::make('value')
                    ->formatStateUsing(fn (SystemConfig $record, ?string $state): string => match (true) {
                        SystemSettings::type($record->key) === SystemSettings::SWITCH => $state === '0' ? 'Off' : 'On',
                        blank($state) => '—',
                        default => (string) $state,
                    })
                    ->limit(60),
                TextColumn::make('description')
                    ->state(fn (SystemConfig $record): ?string => SystemSettings::isKnown($record->key)
                        ? SystemSettings::description($record->key)
                        : 'Not used by the app any more.')
                    ->wrap()
                    ->limit(140)
                    ->toggleable(),
                TextColumn::make('updated_at')
                    ->label('Last changed')
                    ->dateTime(),
            ])
            ->recordActions([
                EditAction::make(),
            ]);
    }
}
