<?php

namespace App\Filament\Resources\SavedAddresses\Schemas;

use Filament\Infolists\Components\IconEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class SavedAddressInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Saved address')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('user.full_name')->label('User'),
                        TextEntry::make('user.phone')->label('Phone')->placeholder('—'),
                        TextEntry::make('label'),
                        IconEntry::make('is_default')->boolean(),
                        TextEntry::make('address')->columnSpanFull(),
                        TextEntry::make('lat')->label('Latitude'),
                        TextEntry::make('lng')->label('Longitude'),
                        TextEntry::make('created_at')->dateTime(),
                    ]),
            ]);
    }
}
