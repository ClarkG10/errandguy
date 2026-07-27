<?php

namespace App\Filament\Resources\Reviews\Schemas;

use Filament\Infolists\Components\IconEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class ReviewInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Review')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('rating')
                            ->formatStateUsing(fn (int $state): string => str_repeat('★', $state).str_repeat('☆', 5 - $state))
                            ->color('warning'),
                        IconEntry::make('is_flagged')->boolean(),
                        TextEntry::make('reviewer.full_name')->label('Reviewer'),
                        TextEntry::make('reviewee.full_name')->label('Reviewee'),
                        TextEntry::make('booking.booking_number')->label('Booking')->placeholder('—'),
                        TextEntry::make('created_at')->dateTime(),
                        TextEntry::make('comment')->placeholder('—')->columnSpanFull(),
                    ]),
            ]);
    }
}
