<?php

namespace App\Filament\Resources\Users\Schemas;

use Filament\Infolists\Components\IconEntry;
use Filament\Infolists\Components\ImageEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class UserInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Profile')
                    ->columns(2)
                    ->schema([
                        ImageEntry::make('avatar_url')->label('Avatar')->circular(),
                        TextEntry::make('full_name'),
                        TextEntry::make('phone'),
                        TextEntry::make('email')->placeholder('—'),
                        TextEntry::make('role')->badge(),
                        TextEntry::make('status')
                            ->badge()
                            ->color(fn (string $state): string => match ($state) {
                                'active' => 'success',
                                'suspended' => 'danger',
                                default => 'gray',
                            }),
                    ]),

                Section::make('Verification')
                    ->columns(2)
                    ->schema([
                        IconEntry::make('email_verified')->boolean(),
                        IconEntry::make('phone_verified')->boolean(),
                        TextEntry::make('suspended_reason')->placeholder('—')->columnSpanFull(),
                        TextEntry::make('suspended_at')->dateTime()->placeholder('—'),
                    ]),

                Section::make('Wallet & ratings')
                    ->columns(3)
                    ->schema([
                        TextEntry::make('wallet_balance')->money('PHP'),
                        TextEntry::make('avg_rating')->label('Average rating')->numeric(2),
                        TextEntry::make('total_ratings')->label('Total ratings')->numeric(),
                    ]),

                Section::make('Activity')
                    ->columns(3)
                    ->schema([
                        TextEntry::make('customer_bookings_count')
                            ->label('Bookings placed')
                            ->state(fn ($record): int => $record->customerBookings()->count()),
                        TextEntry::make('runner_bookings_count')
                            ->label('Errands run')
                            ->state(fn ($record): int => $record->runnerBookings()->count()),
                        TextEntry::make('created_at')->label('Joined')->dateTime(),
                    ]),
            ]);
    }
}
