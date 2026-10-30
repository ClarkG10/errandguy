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
 * Top runners leaderboard for the ops team: by lifetime earnings for money
 * roles, and by errands completed for everyone else, who never see earnings.
 */
class TopRunners extends TableWidget
{
    protected static ?int $sort = 8;

    protected static ?string $heading = 'Top runners';

    protected int|string|array $columnSpan = 'full';

    public function table(Table $table): Table
    {
        $canSeeMoney = auth('admin')->user()?->canManageMoney() ?? false;
        $rankBy = $canSeeMoney ? 'total_earnings' : 'total_errands';

        return $table
            ->query(fn (): Builder => RunnerProfile::query()
                ->where('verification_status', 'approved')
                ->select('runner_profiles.*')
                ->selectRaw("row_number() over (order by {$rankBy} desc) as rank_position")
                ->with('user:id,full_name,avatar_url,avg_rating')
                ->orderByDesc($rankBy))
            ->paginated([10])
            ->defaultSort($rankBy, 'desc')
            ->columns([
                TextColumn::make('rank_position')
                    ->label('#')
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
                    ->alignEnd()
                    ->visible($canSeeMoney),
            ])
            ->recordUrl(fn (RunnerProfile $record): string => RunnerProfileResource::getUrl('view', ['record' => $record]));
    }
}
