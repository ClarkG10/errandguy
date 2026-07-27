<?php

namespace App\Filament\Resources\WalletTransactions\Schemas;

use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class WalletTransactionInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Wallet transaction')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('user.full_name')->label('User'),
                        TextEntry::make('type')->badge(),
                        TextEntry::make('amount')->money('PHP'),
                        TextEntry::make('balance_after')->money('PHP'),
                        TextEntry::make('status')->badge(),
                        TextEntry::make('reference_id')->placeholder('—'),
                        TextEntry::make('description')->columnSpanFull()->placeholder('—'),
                        TextEntry::make('failure_reason')->placeholder('—'),
                        TextEntry::make('processed_at')->dateTime()->placeholder('—'),
                        TextEntry::make('created_at')->dateTime(),
                    ]),
            ]);
    }
}
