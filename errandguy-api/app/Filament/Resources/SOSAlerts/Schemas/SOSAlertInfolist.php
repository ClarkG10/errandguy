<?php

namespace App\Filament\Resources\SOSAlerts\Schemas;

use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class SOSAlertInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Alert')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('status')
                            ->badge()
                            ->color(fn (string $state): string => match ($state) {
                                'active' => 'danger',
                                'resolved' => 'success',
                                default => 'gray',
                            }),
                        TextEntry::make('triggered_by_role')->badge(),
                        TextEntry::make('created_at')->label('Triggered')->dateTime(),
                        TextEntry::make('resolved_at')->dateTime()->placeholder('—'),
                        TextEntry::make('resolution_note')->placeholder('—')->columnSpanFull(),
                    ]),
                Section::make('Participants')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('customer.full_name')->label('Customer')->placeholder('—'),
                        TextEntry::make('runner.full_name')->label('Runner')->placeholder('—'),
                        TextEntry::make('booking.booking_number')->label('Booking')->placeholder('—'),
                    ]),
                Section::make('Emergency contacts notified')
                    ->schema([
                        TextEntry::make('contacts_notified')
                            ->hiddenLabel()
                            ->listWithLineBreaks()
                            ->placeholder('No contacts recorded'),
                    ]),
                Section::make('Live link & location')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('live_link_token')->placeholder('—'),
                        TextEntry::make('live_link_expires_at')->dateTime()->placeholder('—'),
                        TextEntry::make('customer_lat')->label('Customer lat')->placeholder('—'),
                        TextEntry::make('customer_lng')->label('Customer lng')->placeholder('—'),
                        TextEntry::make('runner_lat')->label('Runner lat')->placeholder('—'),
                        TextEntry::make('runner_lng')->label('Runner lng')->placeholder('—'),
                    ]),
            ]);
    }
}
