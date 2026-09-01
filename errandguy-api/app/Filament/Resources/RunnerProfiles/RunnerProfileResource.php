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
        // withDocumentCounts(): the list's "Docs" cell (and its ready/incomplete
        // colour) resolves from these aggregates, so a reviewable application is
        // distinguishable without opening the row.
        return parent::getEloquentQuery()->with(['user'])->withDocumentCounts();
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
        return [
            RelationManagers\RunnerErrandsRelationManager::class,
            RelationManagers\RunnerDocumentsRelationManager::class,
        ];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListRunnerProfiles::route('/'),
            'view' => ViewRunnerProfile::route('/{record}/view'),
        ];
    }

    /**
     * Sidebar badge: applications an admin can ACT on right now.
     *
     * This counted raw verification_status = 'pending', but a bare profile row is
     * created at registration before any upload — so the badge counted every
     * account that ever signed up, never dropped, and stopped meaning "work is
     * waiting". Empty applications are still reachable (the Incomplete tab, which
     * carries its own count); they just no longer inflate the queue.
     */
    public static function getNavigationBadge(): ?string
    {
        $n = static::readyForReviewCount();

        return $n ? (string) $n : null;
    }

    /**
     * Cached count of pending applications with every required document on file.
     * Shared by the sidebar badge and the list's "Ready to review" tab so both
     * read from one query (RunnerDocumentController forgets this key the moment a
     * runner uploads, so a completed application appears immediately).
     */
    public static function readyForReviewCount(): int
    {
        return (int) \App\Support\AdminCache::remember(
            \App\Support\AdminCache::BADGE_VERIFICATIONS,
            fn (): int => RunnerProfile::query()->pending()->readyForReview()->count(),
        );
    }

    public static function getNavigationBadgeColor(): ?string
    {
        return 'warning';
    }

    public static function getNavigationBadgeTooltip(): ?string
    {
        return 'Runner applications ready to review';
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
