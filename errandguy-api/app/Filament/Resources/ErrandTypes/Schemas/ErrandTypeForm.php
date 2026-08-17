<?php

namespace App\Filament\Resources\ErrandTypes\Schemas;

use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\Toggle;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class ErrandTypeForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Details')
                    ->columns(2)
                    ->schema([
                        TextInput::make('name')
                            ->required()
                            ->maxLength(60),
                        TextInput::make('slug')
                            ->required()
                            ->maxLength(30)
                            ->unique(ignoreRecord: true)
                            ->helperText('Stable identifier used by the app. Avoid changing once live.'),
                        Textarea::make('description')
                            ->columnSpanFull()
                            ->rows(2),
                        TextInput::make('icon_name')
                            ->maxLength(50)
                            ->helperText('Icon key the mobile app maps to.'),
                        TextInput::make('sort_order')
                            ->numeric()
                            ->default(0)
                            ->helperText('Lower shows first in the app.'),
                        Toggle::make('is_active')
                            ->default(true)
                            ->helperText('Hidden from the app when off.'),
                    ]),
                Section::make('Pricing')
                    ->description('Drives PricingService. Fees are in ₱.')
                    ->columns(3)
                    ->schema([
                        TextInput::make('base_fee')->numeric()->minValue(0)->prefix('₱')->default(0)->required(),
                        TextInput::make('surcharge')->numeric()->minValue(0)->prefix('₱')->default(0),
                        TextInput::make('min_negotiate_fee')->numeric()->minValue(0)->prefix('₱')->default(0)
                            ->helperText('Floor for negotiate-mode offers.'),
                        TextInput::make('per_km_walk')->label('Per km — walk')->numeric()->minValue(0)->prefix('₱')->default(0),
                        TextInput::make('per_km_bicycle')->label('Per km — bicycle')->numeric()->minValue(0)->prefix('₱')->default(0),
                        TextInput::make('per_km_motorcycle')->label('Per km — motorcycle')->numeric()->minValue(0)->prefix('₱')->default(0),
                        TextInput::make('per_km_car')->label('Per km — car')->numeric()->minValue(0)->prefix('₱')->default(0),
                    ]),
            ]);
    }
}
