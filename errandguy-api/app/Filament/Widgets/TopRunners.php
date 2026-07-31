<?php

namespace App\Filament\Widgets;

use App\Filament\Resources\RunnerProfiles\RunnerProfileResource;
use App\Models\RunnerProfile;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Filament\Widgets\TableWidget;
use Illuminate\Database\Eloquent\Builder;

/**
 * Top runners by lifetime earnings — a leaderboard for the ops team.
 */
class TopRunners extends TableWidget
{
    protected static ?int $sort = 8;

    protected static ?string $heading = 'Top runners';

    protected int|string|array $columnSpan = 'full';

    public function table(Table $table): Table
    {
        return $table
            ->query(fn (): Builder => RunnerProfile::query()
                ->where('verification_status', 'approved')
                ->with('user:id,full_name,avatar_url,avg_rating')
                ->orderByDesc('total_earnings'))
            ->paginated([10])
            ->defaultSort('total_earnings', 'desc')
            ->columns([
                TextColumn::make('rank')
                    ->label('#')
                    ->state(fn (RunnerProfile $record): int => RunnerProfile::query()
                        ->where('verification_status', 'approved')
                        ->where('total_earnings', '>', $record->total_earnings)
                        ->count() + 1)
                    ->badge()
                    ->color(fn (int $state): string => $state <= 3 ? 'accent' : 'gray')
                    ->alignCenter(),
                TextColumn::make('user.full_name')
                    ->label('Runner')
                    ->searchable()
                    ->weight('semibold')
                    ->description(fn (RunnerProfile $r): string => $r->vehicle_type ? ucfirst((string) $r->vehicle_type) : '—'),
                IconColumn::make('is_online')->label('Online')->boolean(),
                TextColumn::make('total_errands')->label('Errands')->sortable()->alignEnd(),
                TextColumn::make('user.avg_rating')
                    ->label('Rating')
                    ->numeric(2)
                    ->icon('heroicon-m-star')
                    ->iconColor('accent')
                    ->placeholder('—')
                    ->alignEnd(),
                TextColumn::make('total_earnings')
                    ->label('Lifetime earnings')
                    ->money('PHP')
                    ->sortable()
                    ->weight('bold')
                    ->color('success')
                    ->alignEnd(),
            ])
            ->recordUrl(fn (RunnerProfile $record): string => RunnerProfileResource::getUrl('view', ['record' => $record]));
    }
}
