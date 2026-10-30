<?php

namespace App\Filament\Resources\SystemConfigs\Schemas;

use App\Models\SystemConfig;
use App\Support\PhilippinePhone;
use Closure;
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
                            // The ops alert recipients may be emptied to turn
                            // those alerts off; every other setting needs a value.
                            ->required(fn (?SystemConfig $record): bool => ! in_array($record?->key, SystemConfig::BLANK_ALLOWED_KEYS, true))
                            // The column is NOT NULL: an emptied field saves as ''.
                            ->dehydrateStateUsing(fn (?string $state): string => $state ?? '')
                            ->rules(fn (?SystemConfig $record): array => self::valueRules($record?->key))
                            ->rows(3),
                        Textarea::make('description')
                            ->rows(2),
                    ]),
            ]);
    }

    /**
     * Checks for settings with a fixed format, so a typo is caught here rather
     * than silently dropping an alert recipient later.
     *
     * @return array<int, Closure>
     */
    public static function valueRules(?string $key): array
    {
        return match ($key) {
            'ops_alert_emails' => [function (string $attribute, mixed $value, Closure $fail): void {
                foreach (self::entries($value) as $entry) {
                    if (! filter_var($entry, FILTER_VALIDATE_EMAIL)) {
                        $fail("“{$entry}” is not an email address. Separate addresses with commas.");

                        return;
                    }
                }
            }],
            'ops_alert_phone' => [function (string $attribute, mixed $value, Closure $fail): void {
                foreach (self::entries($value) as $entry) {
                    if (PhilippinePhone::normalize($entry) === null) {
                        $fail("“{$entry}” is not a Philippine mobile number (like 09171234567). Separate numbers with commas.");

                        return;
                    }
                }
            }],
            default => [],
        };
    }

    /** @return array<int,string> */
    private static function entries(mixed $value): array
    {
        if (! is_string($value)) {
            return [];
        }

        return array_values(array_filter(array_map('trim', explode(',', $value)), fn (string $e): bool => $e !== ''));
    }
}
