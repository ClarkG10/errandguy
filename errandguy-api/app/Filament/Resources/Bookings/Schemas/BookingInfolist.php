<?php

namespace App\Filament\Resources\Bookings\Schemas;

use Filament\Infolists\Components\ImageEntry;
use Filament\Infolists\Components\RepeatableEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class BookingInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Summary')
                    ->columns(3)
                    ->schema([
                        TextEntry::make('booking_number'),
                        TextEntry::make('status')
                            ->badge()
                            ->color(fn (string $state): string => match ($state) {
                                'completed', 'delivered' => 'success',
                                'cancelled', 'no_runner' => 'danger',
                                default => 'warning',
                            }),
                        TextEntry::make('payment_status')
                            ->badge()
                            ->color(fn (string $state): string => match ($state) {
                                'paid' => 'success',
                                'failed', 'expired' => 'danger',
                                'refunded' => 'info',
                                default => 'warning',
                            }),
                        TextEntry::make('payment_method')->badge()->color('gray'),
                        TextEntry::make('schedule_type')->badge()->color('gray'),
                        TextEntry::make('pricing_mode')->badge()->color('gray'),
                        TextEntry::make('base_fee')->money('PHP'),
                        TextEntry::make('distance_fee')->money('PHP'),
                        TextEntry::make('service_fee')->money('PHP'),
                        TextEntry::make('surcharge')->money('PHP'),
                        TextEntry::make('promo_discount')->money('PHP'),
                        TextEntry::make('runner_payout')->money('PHP'),
                        TextEntry::make('cancellation_fee')->money('PHP'),
                        TextEntry::make('total_amount')->money('PHP')->weight('bold'),
                    ]),

                Section::make('Route')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('pickup_address')->columnSpanFull(),
                        TextEntry::make('pickup_contact_name')->label('Pickup contact')->placeholder('—'),
                        TextEntry::make('pickup_contact_phone')->label('Pickup phone')->placeholder('—'),
                        TextEntry::make('dropoff_address')->columnSpanFull(),
                        TextEntry::make('dropoff_contact_name')->label('Dropoff contact')->placeholder('—'),
                        TextEntry::make('dropoff_contact_phone')->label('Dropoff phone')->placeholder('—'),
                        TextEntry::make('description')->placeholder('—')->columnSpanFull(),
                        TextEntry::make('special_instructions')->placeholder('—')->columnSpanFull(),
                    ]),

                Section::make('People')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('customer.full_name')->label('Customer'),
                        TextEntry::make('customer.phone')->label('Customer phone')->placeholder('—'),
                        TextEntry::make('runner.full_name')->label('Runner')->placeholder('Unassigned'),
                        TextEntry::make('runner.phone')->label('Runner phone')->placeholder('—'),
                        TextEntry::make('errandType.name')->label('Errand type')->placeholder('—'),
                    ]),

                Section::make('Photos')
                    ->columns(2)
                    ->schema([
                        ImageEntry::make('item_photos')->label('Item photos')->columnSpanFull()
                            ->hidden(fn ($record): bool => blank($record->item_photos)),
                        ImageEntry::make('pickup_photo_url')->label('Pickup photo')
                            ->hidden(fn ($record): bool => blank($record->pickup_photo_url)),
                        ImageEntry::make('delivery_photo_url')->label('Delivery photo')
                            ->hidden(fn ($record): bool => blank($record->delivery_photo_url)),
                        ImageEntry::make('signature_url')->label('Signature')
                            ->hidden(fn ($record): bool => blank($record->signature_url)),
                        ImageEntry::make('receipt_photo_url')->label('Receipt')
                            ->hidden(fn ($record): bool => blank($record->receipt_photo_url)),
                    ]),

                Section::make('Timeline')
                    ->schema([
                        RepeatableEntry::make('statusLogs')
                            ->hiddenLabel()
                            ->columns(3)
                            ->schema([
                                TextEntry::make('status')->badge()->color('gray'),
                                TextEntry::make('note')->placeholder('—'),
                                TextEntry::make('created_at')->dateTime(),
                            ]),
                    ]),

                Section::make('Chat')
                    ->description('Customer ↔ runner messages for this booking.')
                    ->collapsible()
                    ->collapsed()
                    ->schema([
                        RepeatableEntry::make('messages')
                            ->hiddenLabel()
                            ->columns(3)
                            ->schema([
                                TextEntry::make('sender.full_name')->label('From')->placeholder('System'),
                                TextEntry::make('content')->placeholder('—')->columnSpan(2),
                                ImageEntry::make('image_url')->label('Image')->columnSpanFull()
                                    ->hidden(fn ($record): bool => blank($record->image_url)),
                                TextEntry::make('created_at')->dateTime()->columnSpanFull(),
                            ]),
                    ]),
            ]);
    }
}
