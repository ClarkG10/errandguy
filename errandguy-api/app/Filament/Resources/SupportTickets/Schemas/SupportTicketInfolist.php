<?php

namespace App\Filament\Resources\SupportTickets\Schemas;

use App\Filament\Resources\Users\UserResource;
use App\Models\SupportTicket;
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
                        // "Report this person" tickets: who the report is about.
                        TextEntry::make('reportedUser.full_name')
                            ->label('Reported person')
                            ->visible(fn (SupportTicket $record): bool => filled($record->reported_user_id))
                            ->url(fn (SupportTicket $record): ?string => $record->reported_user_id
                                ? UserResource::getUrl('view', ['record' => $record->reported_user_id])
                                : null),
                        TextEntry::make('last_message_at')->dateTime()->placeholder('—'),
                        TextEntry::make('created_at')->dateTime(),
                    ]),
            ]);
    }
}
