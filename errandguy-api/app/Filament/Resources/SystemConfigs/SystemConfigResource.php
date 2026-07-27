<?php

namespace App\Filament\Resources\SystemConfigs;

use App\Filament\Resources\SystemConfigs\Pages\EditSystemConfig;
use App\Filament\Resources\SystemConfigs\Pages\ListSystemConfigs;
use App\Filament\Resources\SystemConfigs\Schemas\SystemConfigForm;
use App\Filament\Resources\SystemConfigs\Tables\SystemConfigsTable;
use App\Models\SystemConfig;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Model;

class SystemConfigResource extends Resource
{
    protected static ?string $model = SystemConfig::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedCog;

    protected static string|\UnitEnum|null $navigationGroup = 'System';

    protected static ?int $navigationSort = 10;

    protected static ?string $recordTitleAttribute = 'key';

    // Model PK is the string column `key`; bind routes on it explicitly.
    protected static ?string $recordRouteKeyName = 'key';

    public static function form(Schema $schema): Schema
    {
        return SystemConfigForm::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return SystemConfigsTable::configure($table);
    }

    public static function getRelations(): array
    {
        return [];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListSystemConfigs::route('/'),
            'edit' => EditSystemConfig::route('/{record}/edit'),
        ];
    }

    // --- Authorization: super_admin only; edit values, never create/delete keys ---

    public static function canViewAny(): bool
    {
        return auth('admin')->user()?->canManageSystem() ?? false;
    }

    public static function canCreate(): bool
    {
        return false;
    }

    public static function canEdit(Model $record): bool
    {
        return auth('admin')->user()?->canManageSystem() ?? false;
    }

    public static function canDelete(Model $record): bool
    {
        return false;
    }
}
