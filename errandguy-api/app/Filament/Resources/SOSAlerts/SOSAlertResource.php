<?php

namespace App\Filament\Resources\SOSAlerts;

use App\Filament\Resources\SOSAlerts\Pages\ListSOSAlerts;
use App\Filament\Resources\SOSAlerts\Pages\ViewSOSAlert;
use App\Filament\Resources\SOSAlerts\Schemas\SOSAlertInfolist;
use App\Filament\Resources\SOSAlerts\Tables\SOSAlertsTable;
use App\Models\SOSAlert;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class SOSAlertResource extends Resource
{
    protected static ?string $model = SOSAlert::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedShieldExclamation;

    protected static string|\UnitEnum|null $navigationGroup = 'Safety & Support';

    protected static ?int $navigationSort = 10;

    protected static ?string $slug = 'sos-alerts';

    public static function infolist(Schema $schema): Schema
    {
        return SOSAlertInfolist::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return SOSAlertsTable::configure($table);
    }

    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()->with(['booking', 'customer', 'runner']);
    }

    public static function getRelations(): array
    {
        return [];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListSOSAlerts::route('/'),
            'view' => ViewSOSAlert::route('/{record}/view'),
        ];
    }

    public static function getNavigationBadge(): ?string
    {
        $n = \App\Support\AdminCache::remember(
            \App\Support\AdminCache::BADGE_SOS,
            fn () => SOSAlert::where('status', 'active')->count(),
        );

        return $n ? (string) $n : null;
    }

    public static function getNavigationBadgeColor(): ?string
    {
        return 'danger';
    }

    // --- Authorization: view-only, support roles only ---

    public static function canViewAny(): bool
    {
        return auth('admin')->user()?->canHandleSupport() ?? false;
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
