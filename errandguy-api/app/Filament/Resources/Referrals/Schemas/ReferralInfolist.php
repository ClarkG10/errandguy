<?php

namespace App\Filament\Resources\Referrals\Schemas;

use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class ReferralInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Referral')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('referrer.full_name')->label('Referrer'),
                        TextEntry::make('referee.full_name')->label('Referee'),
                        TextEntry::make('status')->badge(),
                        TextEntry::make('reward_amount')->money('PHP'),
                        TextEntry::make('qualified_at')->dateTime()->placeholder('—'),
                        TextEntry::make('rewarded_at')->dateTime()->placeholder('—'),
                        TextEntry::make('created_at')->dateTime(),
                    ]),
            ]);
    }
}
