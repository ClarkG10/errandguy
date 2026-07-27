<?php

namespace App\Filament\Resources\SupportTickets\Schemas;

use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class SupportTicketInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Ticket')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('subject')->columnSpanFull(),
                        TextEntry::make('status')
                            ->badge()
                            ->color(fn (string $state): string => match ($state) {
                                'resolved' => 'success',
                                'open' => 'warning',
                                'pending' => 'info',
                                'closed' => 'gray',
                                default => 'gray',
                            }),
                        TextEntry::make('category')->placeholder('—'),
                        TextEntry::make('user.full_name')->label('User')->placeholder('—'),
                        TextEntry::make('booking.booking_number')->label('Booking')->placeholder('—'),
                        TextEntry::make('last_message_at')->dateTime()->placeholder('—'),
                        TextEntry::make('created_at')->dateTime(),
                    ]),
            ]);
    }
}
