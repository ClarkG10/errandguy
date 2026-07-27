<?php

namespace App\Filament\Resources\SystemConfigs\Schemas;

use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class SystemConfigForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Configuration')
                    ->schema([
                        TextInput::make('key')
                            ->disabled()
                            ->helperText('Immutable identifier. Cannot be changed.'),
                        Textarea::make('value')
                            ->required()
                            ->rows(3),
                        Textarea::make('description')
                            ->rows(2),
                    ]),
            ]);
    }
}
