<?php

namespace App\Filament\Resources\RunnerProfiles\Schemas;

use App\Models\RunnerProfile;
use Filament\Infolists\Components\IconEntry;
use Filament\Infolists\Components\ImageEntry;
use Filament\Infolists\Components\TextEntry;
use Filament\Infolists\Components\ViewEntry;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Components\Tabs;
use Filament\Schemas\Components\Tabs\Tab;
use Filament\Schemas\Schema;
use Filament\Support\Enums\TextSize;

class RunnerProfileInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                // ---- Runner hero ----
                Section::make()
                    ->columns(4)
                    ->schema([
                        TextEntry::make('user.full_name')
                            ->label('Runner')
                            ->weight('bold')
                            ->size(TextSize::Large)
                            ->columnSpan(2),
                        TextEntry::make('verification_status')
                            ->badge()
                            ->color(fn (string $state): string => match ($state) {
                                'approved' => 'success',
                                'pending' => 'warning',
                                'rejected' => 'danger',
                                default => 'gray',
                            }),
                        IconEntry::make('is_online')->label('Online')->boolean(),
                        TextEntry::make('user.phone')->label('Phone')->icon('heroicon-m-phone')->copyable()->placeholder('—'),
                        TextEntry::make('approved_at')->dateTime()->placeholder('—'),
                        TextEntry::make('total_earnings')->money('PHP')->weight('bold')->color('success'),
                        TextEntry::make('total_errands')->numeric(),
                    ]),

                Tabs::make()
                    ->columnSpanFull()
                    ->persistTabInQueryString()
                    ->tabs([
                        Tab::make('Performance')
                            ->icon('heroicon-m-chart-bar')
                            ->schema([
                                Section::make()
                                    ->columns(3)
                                    ->schema([
                                        TextEntry::make('acceptance_rate')->suffix('%')->placeholder('—'),
                                        TextEntry::make('completion_rate')->suffix('%')->placeholder('—'),
                                        TextEntry::make('user.avg_rating')->label('Rating')->numeric(2)->icon('heroicon-m-star')->iconColor('accent')->placeholder('—'),
                                        TextEntry::make('working_area_radius')->label('Working radius')->suffix(' m')->numeric()->placeholder('—'),
                                        TextEntry::make('bank_name')->placeholder('—'),
                                    ]),
                            ]),

                        Tab::make('Vehicle')
                            ->icon('heroicon-m-truck')
                            ->schema([
                                Section::make()
                                    ->columns(3)
                                    ->schema([
                                        TextEntry::make('vehicle_type')->badge()->color('gray'),
                                        TextEntry::make('vehicle_plate')->placeholder('—')->copyable(),
                                        ImageEntry::make('vehicle_photo_url')->label('Vehicle photo')->placeholder('—')->height(160),
                                    ]),
                            ]),

                        Tab::make('Documents')
                            ->icon('heroicon-m-identification')
                            ->badge(fn (RunnerProfile $record): ?string => ($n = $record->documents()->count()) ? (string) $n : null)
                            ->schema([
                                ViewEntry::make('documents_gallery')
                                    ->hiddenLabel()
                                    ->view('filament.entries.image-gallery', fn (RunnerProfile $record): array => [
                                        'images' => $record->documents()->get()->map(fn ($d): array => [
                                            'label' => ucwords(str_replace('_', ' ', (string) $d->document_type)).' · '.ucfirst((string) $d->status),
                                            'url' => $d->adminFileUrl(),
                                        ])->all(),
                                    ]),
                            ]),
                    ]),
            ]);
    }
}
