<?php

namespace App\Filament\Resources\Users\RelationManagers;

use App\Filament\Resources\Bookings\BookingResource;
use App\Models\Booking;
use Filament\Resources\RelationManagers\RelationManager;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Model;

class RunnerBookingsRelationManager extends RelationManager
{
    protected static string $relationship = 'runnerBookings';

    protected static ?string $title = 'Errands run';

    protected static string|\BackedEnum|null $icon = 'heroicon-m-truck';

    protected static ?string $recordTitleAttribute = 'booking_number';

    /** Only relevant for runner accounts. */
    public static function canViewForRecord(Model $ownerRecord, string $pageClass): bool
    {
        return $ownerRecord->role === 'runner';
    }

    public function table(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->paginated([10, 25])
            ->columns([
                TextColumn::make('booking_number')->searchable()->weight('semibold'),
                TextColumn::make('status')->badge()->color(fn (string $s): string => match ($s) {
                    'completed', 'delivered' => 'success',
                    'cancelled', 'no_runner' => 'danger',
                    default => 'warning',
                }),
                TextColumn::make('runner_payout')->label('Payout')->money('PHP')->color('success')->alignEnd(),
                TextColumn::make('total_amount')->money('PHP')->alignEnd(),
                TextColumn::make('completed_at')->label('Completed')->since()->dateTimeTooltip()->placeholder('—')->alignEnd(),
            ])
            ->recordUrl(fn (Booking $record): string => BookingResource::getUrl('view', ['record' => $record]));
    }
}
