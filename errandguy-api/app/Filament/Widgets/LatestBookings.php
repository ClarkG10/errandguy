<?php

namespace App\Filament\Widgets;

use App\Filament\Resources\Bookings\BookingResource;
use App\Models\Booking;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Filament\Widgets\TableWidget;
use Illuminate\Database\Eloquent\Builder;

class LatestBookings extends TableWidget
{
    protected static ?int $sort = 9;

    protected static ?string $heading = 'Latest bookings';

    protected int|string|array $columnSpan = 'full';

    public function table(Table $table): Table
    {
        return $table
            ->query(fn (): Builder => Booking::query()->with(['customer:id,full_name', 'runner:id,full_name']))
            ->defaultSort('created_at', 'desc')
            ->paginated([10])
            ->columns([
                TextColumn::make('booking_number')->label('Booking')->searchable()->weight('semibold'),
                TextColumn::make('customer.full_name')->label('Customer')->description(fn (Booking $b): ?string => $b->runner?->full_name ? 'Runner: '.$b->runner->full_name : 'Unassigned'),
                TextColumn::make('status')->badge()->color(fn (string $state): string => match ($state) {
                    'completed' => 'success',
                    'cancelled', 'no_runner' => 'danger',
                    'pending' => 'warning',
                    default => 'info',
                }),
                TextColumn::make('payment_status')->label('Payment')->badge()->color(fn (string $state): string => match ($state) {
                    'paid' => 'success',
                    'failed', 'expired' => 'danger',
                    'refunded' => 'info',
                    default => 'warning',
                }),
                TextColumn::make('total_amount')->money('PHP')->weight('semibold')->alignEnd(),
                TextColumn::make('created_at')->label('Placed')->since()->dateTimeTooltip()->alignEnd(),
            ])
            ->recordUrl(fn (Booking $record): string => BookingResource::getUrl('view', ['record' => $record]));
    }
}
