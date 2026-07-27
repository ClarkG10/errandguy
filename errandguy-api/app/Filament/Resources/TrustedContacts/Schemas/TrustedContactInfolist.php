<?php

namespace App\Filament\Resources\TrustedContacts\Schemas;

use Filament\Infolists\Components\IconEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class TrustedContactInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Trusted contact')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('user.full_name')->label('User'),
                        TextEntry::make('name'),
                        TextEntry::make('phone'),
                        TextEntry::make('relationship')->placeholder('—'),
                        TextEntry::make('priority')->numeric(),
                        IconEntry::make('is_active')->boolean(),
                    ]),
            ]);
    }
}
