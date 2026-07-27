<?php

namespace App\Filament\Widgets;

use App\Models\Booking;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Filament\Widgets\TableWidget;
use Illuminate\Database\Eloquent\Builder;

class LatestBookings extends TableWidget
{
    protected static ?string $heading = 'Latest bookings';

    protected int|string|array $columnSpan = 'full';

    public function table(Table $table): Table
    {
        return $table
            ->query(fn (): Builder => Booking::query()->with(['customer:id,full_name', 'runner:id,full_name']))
            ->defaultSort('created_at', 'desc')
            ->paginated([10])
            ->columns([
                TextColumn::make('booking_number')->searchable(),
                TextColumn::make('customer.full_name')->label('Customer'),
                TextColumn::make('runner.full_name')->label('Runner')->placeholder('—'),
                TextColumn::make('status')->badge()->color(fn (string $state): string => match ($state) {
                    'completed' => 'success',
                    'cancelled', 'no_runner' => 'danger',
                    'pending' => 'warning',
                    default => 'info',
                }),
                TextColumn::make('total_amount')->money('PHP'),
                TextColumn::make('created_at')->dateTime()->since(),
            ]);
    }
}
