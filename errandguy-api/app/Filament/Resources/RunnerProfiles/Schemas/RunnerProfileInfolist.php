<?php

namespace App\Filament\Resources\RunnerProfiles\Schemas;

use Filament\Infolists\Components\IconEntry;
use Filament\Infolists\Components\ImageEntry;
use Filament\Infolists\Components\RepeatableEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

class RunnerProfileInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Runner')
                    ->columns(2)
                    ->schema([
                        TextEntry::make('user.full_name')->label('Name'),
                        TextEntry::make('user.phone')->label('Phone'),
                        TextEntry::make('verification_status')
                            ->badge()
                            ->color(fn (string $state): string => match ($state) {
                                'approved' => 'success',
                                'pending' => 'warning',
                                'rejected' => 'danger',
                                default => 'gray',
                            }),
                        IconEntry::make('is_online')->boolean(),
                        TextEntry::make('approved_at')->dateTime()->placeholder('—'),
                    ]),

                Section::make('Vehicle')
                    ->columns(3)
                    ->schema([
                        TextEntry::make('vehicle_type')->badge()->color('gray'),
                        TextEntry::make('vehicle_plate')->placeholder('—'),
                        ImageEntry::make('vehicle_photo_url')->label('Vehicle photo')->placeholder('—'),
                    ]),

                Section::make('Performance')
                    ->columns(4)
                    ->schema([
                        TextEntry::make('acceptance_rate')->suffix('%'),
                        TextEntry::make('completion_rate')->suffix('%'),
                        TextEntry::make('total_errands')->numeric(),
                        TextEntry::make('total_earnings')->money('PHP'),
                        TextEntry::make('working_area_radius')->label('Working radius (m)')->numeric(),
                        TextEntry::make('bank_name')->placeholder('—'),
                    ]),

                Section::make('Documents')
                    ->schema([
                        RepeatableEntry::make('documents')
                            ->hiddenLabel()
                            ->columns(2)
                            ->schema([
                                TextEntry::make('document_type')->badge()->color('gray'),
                                TextEntry::make('status')
                                    ->badge()
                                    ->color(fn (string $state): string => match ($state) {
                                        'approved' => 'success',
                                        'pending' => 'warning',
                                        'rejected' => 'danger',
                                        default => 'gray',
                                    }),
                                ImageEntry::make('file_url')->label('File')->columnSpanFull(),
                            ]),
                    ]),
            ]);
    }
}
