<?php

namespace App\Filament\Resources\Notifications\Schemas;

use Filament\Infolists\Components\IconEntry;
use Filament\Infolists\Components\KeyValueEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class NotificationInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Notification')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('title'),
                        TextEntry::make('type')->badge(),
                        TextEntry::make('user.full_name')->label('User')->placeholder('—'),
                        IconEntry::make('is_read')->boolean(),
                        TextEntry::make('created_at')->dateTime(),
                        TextEntry::make('archived_at')->dateTime()->placeholder('—'),
                        TextEntry::make('body')->columnSpanFull()->placeholder('—'),
                    ]),
                Section::make('Payload')
                    ->schema([
                        KeyValueEntry::make('data')
                            ->hiddenLabel(),
                    ]),
            ]);
    }
}
