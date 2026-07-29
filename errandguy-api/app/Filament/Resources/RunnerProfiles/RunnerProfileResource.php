<?php

namespace App\Filament\Resources\RunnerProfiles;

use App\Filament\Resources\RunnerProfiles\Pages\ListRunnerProfiles;
use App\Filament\Resources\RunnerProfiles\Pages\ViewRunnerProfile;
use App\Filament\Resources\RunnerProfiles\Schemas\RunnerProfileInfolist;
use App\Filament\Resources\RunnerProfiles\Tables\RunnerProfilesTable;
use App\Models\RunnerProfile;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class RunnerProfileResource extends Resource
{
    protected static ?string $model = RunnerProfile::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedTruck;

    protected static string|\UnitEnum|null $navigationGroup = 'People';

    protected static ?int $navigationSort = 20;

    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()->with(['user']);
    }

    public static function infolist(Schema $schema): Schema
    {
        return RunnerProfileInfolist::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return RunnerProfilesTable::configure($table);
    }

    public static function getRelations(): array
    {
        return [];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListRunnerProfiles::route('/'),
            'view' => ViewRunnerProfile::route('/{record}/view'),
        ];
    }

    /** Sidebar badge: runners awaiting verification (the review queue). */
    public static function getNavigationBadge(): ?string
    {
        $n = \App\Support\AdminCache::remember(
            \App\Support\AdminCache::BADGE_VERIFICATIONS,
            fn () => RunnerProfile::where('verification_status', 'pending')->count(),
        );

        return $n ? (string) $n : null;
    }

    public static function getNavigationBadgeColor(): ?string
    {
        return 'warning';
    }

    public static function getNavigationBadgeTooltip(): ?string
    {
        return 'Runners awaiting verification';
    }

    /** Global search (top bar): find runners by name, plate, or phone. */
    public static function getGloballySearchableAttributes(): array
    {
        return ['user.full_name', 'user.phone', 'vehicle_plate'];
    }

    public static function getGlobalSearchResultTitle(Model $record): string
    {
        return $record->user?->full_name ?? 'Runner';
    }

    public static function getGlobalSearchResultDetails(Model $record): array
    {
        return [
            'Status' => ucfirst((string) $record->verification_status),
            'Vehicle' => $record->vehicle_type ? ucfirst((string) $record->vehicle_type) : '—',
        ];
    }

    // --- Authorization: any signed-in admin can browse; view-only ---

    public static function canViewAny(): bool
    {
        return auth('admin')->check();
    }

    public static function canCreate(): bool
    {
        return false;
    }

    public static function canEdit(Model $record): bool
    {
        return false;
    }

    public static function canDelete(Model $record): bool
    {
        return false;
    }
}
