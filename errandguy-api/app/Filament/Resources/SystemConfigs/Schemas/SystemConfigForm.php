<?php

namespace App\Filament\Resources\SystemConfigs\Schemas;

use App\Models\SystemConfig;
use App\Support\SystemSettings;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\ToggleButtons;
use Filament\Schemas\Components\Component;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

/**
 * Edits one setting's value. The input, the check it must pass and the
 * description all come from SystemSettings, so a value outside the allowed
 * range never reaches the database.
 */
class SystemConfigForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components(fn (?SystemConfig $record): array => [
                Section::make(SystemSettings::label((string) $record?->key))
                    ->description(SystemSettings::description((string) $record?->key) ?? $record?->description)
                    ->schema([
                        TextInput::make('key')
                            ->label('Setting key')
                            ->disabled(),
                        self::valueField($record?->key),
                    ]),
            ]);
    }

    private static function valueField(?string $key): Component
    {
        $type = $key !== null ? SystemSettings::type($key) : null;

        $field = match ($type) {
            SystemSettings::SWITCH => ToggleButtons::make('value')
                ->options(['1' => 'On', '0' => 'Off'])
                ->colors(['1' => 'success', '0' => 'gray'])
                ->inline(),
            SystemSettings::EMAILS, SystemSettings::PHONES => Textarea::make('value')->rows(3),
            default => TextInput::make('value'),
        };

        return $field
            ->label('Value')
            ->helperText($key !== null ? SystemSettings::allowedHint($key) : null)
            // Emails / phone lists may be emptied to switch those alerts off;
            // every other setting needs a value. The column is NOT NULL, so an
            // emptied list saves as ''.
            ->required(! ($key !== null && SystemSettings::blankAllowed($key)))
            ->dehydrateStateUsing(fn (mixed $state): string => SystemSettings::normalize((string) $key, is_scalar($state) ? (string) $state : null))
            // Wrapped so Filament hands the rule closures to the validator
            // instead of evaluating them itself.
            ->rules(fn (): array => SystemSettings::rules($key));
    }
}
