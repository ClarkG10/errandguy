<?php

namespace App\Filament\Resources\ErrandTypes;

use App\Filament\Resources\ErrandTypes\Pages\EditErrandType;
use App\Filament\Resources\ErrandTypes\Pages\ListErrandTypes;
use App\Filament\Resources\ErrandTypes\Schemas\ErrandTypeForm;
use App\Filament\Resources\ErrandTypes\Tables\ErrandTypesTable;
use App\Models\AdminUser;
use App\Models\ErrandType;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Model;

class ErrandTypeResource extends Resource
{
    protected static ?string $model = ErrandType::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedRectangleStack;

    protected static string|\UnitEnum|null $navigationGroup = 'Operations';

    protected static ?int $navigationSort = 30;

    protected static ?string $recordTitleAttribute = 'name';

    public static function form(Schema $schema): Schema
    {
        return ErrandTypeForm::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return ErrandTypesTable::configure($table);
    }

    public static function getRelations(): array
    {
        return [];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListErrandTypes::route('/'),
            'edit' => EditErrandType::route('/{record}/edit'),
        ];
    }

    // --- Authorization: catalog is editable by super_admin + admin only ---

    protected static function canManageCatalog(): bool
    {
        return auth('admin')->user()?->hasAnyRole(AdminUser::ROLE_SUPER_ADMIN, AdminUser::ROLE_ADMIN) ?? false;
    }

    // Each type has its own flow in the app (steps, shopping, single
    // location), so staff edit prices, copy and the on/off switch but never add
    // or remove a type: a new slug has no flow behind it, and a type with
    // errands can't be deleted (bookings reference it).
    public static function canCreate(): bool
    {
        return false;
    }

    public static function canEdit(Model $record): bool
    {
        return static::canManageCatalog();
    }

    public static function canDelete(Model $record): bool
    {
        return false;
    }

    public static function canDeleteAny(): bool
    {
        return false;
    }
}
