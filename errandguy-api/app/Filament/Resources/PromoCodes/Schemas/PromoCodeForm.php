<?php

namespace App\Filament\Resources\PromoCodes\Schemas;

use Filament\Forms\Components\DateTimePicker;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class PromoCodeForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Code')
                    ->columns(2)
                    ->schema([
                        TextInput::make('code')
                            ->required()
                            ->maxLength(30)
                            ->unique(ignoreRecord: true),
                        Textarea::make('description')
                            ->columnSpanFull()
                            ->rows(2),
                    ]),
                Section::make('Discount')
                    ->columns(2)
                    ->schema([
                        Select::make('discount_type')
                            ->options([
                                'percentage' => 'Percentage',
                                'fixed' => 'Fixed amount',
                            ])
                            ->required(),
                        TextInput::make('discount_value')
                            ->numeric()
                            ->required(),
                        TextInput::make('max_discount')
                            ->numeric()
                            ->prefix('₱')
                            ->helperText('Caps a percentage discount. Leave blank for none.'),
                        TextInput::make('min_order')
                            ->numeric()
                            ->prefix('₱')
                            ->helperText('Minimum order value to qualify.'),
                    ]),
                Section::make('Limits & validity')
                    ->columns(2)
                    ->schema([
                        TextInput::make('usage_limit')
                            ->numeric()
                            ->helperText('blank = unlimited'),
                        TextInput::make('per_user_limit')
                            ->numeric()
                            ->default(1),
                        DateTimePicker::make('valid_from'),
                        DateTimePicker::make('valid_until'),
                        Toggle::make('is_active')
                            ->default(true)
                            ->columnSpanFull(),
                    ]),
            ]);
    }
}
