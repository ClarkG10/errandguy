<?php

namespace App\Filament\Resources\Users\Schemas;

use App\Models\User;
use App\Support\AdminAvatar;
use Filament\Infolists\Components\IconEntry;
use Filament\Infolists\Components\ImageEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Enums\TextSize;

class UserInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                // ---- Identity hero ----
                Section::make()
                    ->columns(4)
                    ->schema([
                        ImageEntry::make('avatar_url')
                            ->hiddenLabel()
                            ->circular()
                            ->imageSize(88)
                            ->defaultImageUrl(fn (User $record): string => AdminAvatar::dataUri($record->full_name)),
                        TextEntry::make('full_name')
                            ->hiddenLabel()
                            ->weight('bold')
                            ->size(TextSize::Large)
                            ->columnSpan(2),
                        TextEntry::make('status')
                            ->badge()
                            ->color(fn (string $state): string => match ($state) {
                                'active' => 'success',
                                'suspended' => 'danger',
                                default => 'gray',
                            }),
                        TextEntry::make('role')->badge()->color(fn (string $state): string => $state === 'runner' ? 'info' : 'gray'),
                        TextEntry::make('phone')->icon('heroicon-m-phone')->copyable()->placeholder('—'),
                        TextEntry::make('email')->icon('heroicon-m-envelope')->copyable()->placeholder('—'),
                        TextEntry::make('created_at')->label('Joined')->since()->dateTimeTooltip(),
                    ]),

                // ---- Wallet & reputation ----
                Section::make('Wallet & reputation')
                    ->columns(4)
                    ->schema([
                        TextEntry::make('wallet_balance')->money('PHP')->weight('bold')->color('success'),
                        TextEntry::make('avg_rating')->label('Rating')->numeric(2)->icon('heroicon-m-star')->iconColor('warning')->placeholder('—'),
                        TextEntry::make('total_ratings')->label('Total ratings')->numeric()->placeholder('0'),
                        TextEntry::make('customer_bookings_count')
                            ->label('Bookings placed')
                            ->state(fn (User $record): int => $record->customerBookings()->count()),
                        TextEntry::make('runner_bookings_count')
                            ->label('Errands run')
                            ->state(fn (User $record): int => $record->runnerBookings()->count()),
                    ]),

                // ---- Verification & moderation ----
                Section::make('Verification & moderation')
                    ->columns(4)
                    ->schema([
                        IconEntry::make('email_verified')->boolean(),
                        IconEntry::make('phone_verified')->boolean(),
                        TextEntry::make('suspended_at')->dateTime()->placeholder('—'),
                        TextEntry::make('suspended_reason')->placeholder('—')->columnSpanFull()->color('danger'),
                    ]),
            ]);
    }
}
