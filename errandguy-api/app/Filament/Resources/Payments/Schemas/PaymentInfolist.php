<?php

namespace App\Filament\Resources\Payments\Schemas;

use Filament\Infolists\Components\RepeatableEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class PaymentInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Payment summary')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('booking.booking_number')->label('Booking'),
                        TextEntry::make('customer.full_name')->label('Customer'),
                        TextEntry::make('amount')->money('PHP'),
                        TextEntry::make('currency'),
                        TextEntry::make('method')->badge(),
                        TextEntry::make('status')
                            ->badge()
                            ->color(fn (string $state): string => match ($state) {
                                'completed' => 'success',
                                'pending', 'processing' => 'warning',
                                'failed', 'cancelled', 'expired' => 'danger',
                                'refunded' => 'info',
                                default => 'gray',
                            }),
                        TextEntry::make('gateway_tx_id')->label('Gateway Tx ID')->placeholder('—'),
                        TextEntry::make('paid_at')->dateTime()->placeholder('—'),
                        TextEntry::make('refund_amount')->money('PHP')->placeholder('—'),
                        TextEntry::make('refunded_at')->dateTime()->placeholder('—'),
                        TextEntry::make('created_at')->dateTime(),
                    ]),
                Section::make('Status timeline')
                    ->description('Immutable audit trail of every status change.')
                    ->schema([
                        RepeatableEntry::make('transitions')
                            ->hiddenLabel()
                            ->columns(5)
                            ->schema([
                                TextEntry::make('from_status')->badge()->placeholder('—'),
                                TextEntry::make('to_status')->badge(),
                                TextEntry::make('actor')->placeholder('system'),
                                TextEntry::make('reason')->placeholder('—'),
                                TextEntry::make('created_at')->dateTime(),
                            ]),
                    ]),
            ]);
    }
}
