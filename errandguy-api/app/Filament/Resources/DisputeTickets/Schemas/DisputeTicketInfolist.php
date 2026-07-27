<?php

namespace App\Filament\Resources\DisputeTickets\Schemas;

use Filament\Infolists\Components\ImageEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class DisputeTicketInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Dispute')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('status')
                            ->badge()
                            ->color(fn (string $state): string => match ($state) {
                                'resolved' => 'success',
                                'open', 'reviewing' => 'warning',
                                'escalated' => 'danger',
                                default => 'gray',
                            }),
                        TextEntry::make('category')->placeholder('—'),
                        TextEntry::make('reporter.full_name')->label('Reporter')->placeholder('—'),
                        TextEntry::make('booking.booking_number')->label('Booking')->placeholder('—'),
                        TextEntry::make('created_at')->dateTime(),
                        TextEntry::make('description')->columnSpanFull()->placeholder('—'),
                    ]),
                Section::make('Evidence')
                    ->schema([
                        ImageEntry::make('evidence_urls')
                            ->hiddenLabel()
                            ->placeholder('No evidence attached'),
                    ]),
                Section::make('Resolution')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('resolution')->columnSpanFull()->placeholder('—'),
                        TextEntry::make('resolved_by')->placeholder('—'),
                        TextEntry::make('resolved_at')->dateTime()->placeholder('—'),
                    ]),
            ]);
    }
}
