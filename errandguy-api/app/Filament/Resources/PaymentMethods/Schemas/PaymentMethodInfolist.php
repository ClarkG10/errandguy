<?php

namespace App\Filament\Resources\PaymentMethods\Schemas;

use Filament\Infolists\Components\IconEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class PaymentMethodInfolist
{
    public static function configure(Schema $schema): Schema
    {
        // View-only: gateway_token / gateway_ref are hidden on the model and
        // are deliberately never surfaced here.
        return $schema
            ->components([
                Section::make('Payment method')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('user.full_name')->label('User'),
                        TextEntry::make('type')->badge(),
                        TextEntry::make('label')->placeholder('—'),
                        TextEntry::make('status')->badge(),
                        TextEntry::make('card_brand')->placeholder('—'),
                        TextEntry::make('last_four')->prefix('•••• ')->placeholder('—'),
                        TextEntry::make('channel_code')->placeholder('—'),
                        IconEntry::make('is_default')->boolean(),
                        TextEntry::make('expires_at')->date()->placeholder('—'),
                        TextEntry::make('created_at')->dateTime(),
                    ]),
            ]);
    }
}
