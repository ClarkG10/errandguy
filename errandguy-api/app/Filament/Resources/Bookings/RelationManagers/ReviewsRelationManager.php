<?php

namespace App\Filament\Resources\Bookings\RelationManagers;

use Filament\Resources\RelationManagers\RelationManager;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class ReviewsRelationManager extends RelationManager
{
    protected static string $relationship = 'reviews';

    protected static ?string $title = 'Reviews';

    protected static string|\BackedEnum|null $icon = 'heroicon-m-star';

    public function table(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('rating')->badge()->icon('heroicon-m-star')
                    ->color(fn ($state): string => (int) $state >= 4 ? 'success' : ((int) $state >= 3 ? 'warning' : 'danger')),
                TextColumn::make('reviewer.full_name')->label('From')->placeholder('—'),
                TextColumn::make('reviewee.full_name')->label('About')->placeholder('—'),
                TextColumn::make('comment')->wrap()->limit(80)->placeholder('—'),
                TextColumn::make('created_at')->since()->dateTimeTooltip()->alignEnd(),
            ]);
    }
}
