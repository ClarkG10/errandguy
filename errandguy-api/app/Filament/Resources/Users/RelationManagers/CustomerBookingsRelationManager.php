<?php

namespace App\Filament\Resources\Users\RelationManagers;

use App\Filament\Resources\Bookings\BookingResource;
use App\Models\Booking;
use Filament\Resources\RelationManagers\RelationManager;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

class CustomerBookingsRelationManager extends RelationManager
{
    protected static string $relationship = 'customerBookings';

    protected static ?string $title = 'Bookings placed';

    protected static string|\BackedEnum|null $icon = 'heroicon-m-clipboard-document-list';

    protected static ?string $recordTitleAttribute = 'booking_number';

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
                TextColumn::make('payment_status')->label('Payment')->badge()->color(fn (string $s): string => match ($s) {
                    'paid' => 'success', 'refunded' => 'info', 'failed', 'expired' => 'danger', default => 'warning',
                }),
                TextColumn::make('total_amount')->money('PHP')->alignEnd(),
                TextColumn::make('created_at')->label('Placed')->since()->dateTimeTooltip()->alignEnd(),
            ])
            ->recordUrl(fn (Booking $record): string => BookingResource::getUrl('view', ['record' => $record]));
    }
}
