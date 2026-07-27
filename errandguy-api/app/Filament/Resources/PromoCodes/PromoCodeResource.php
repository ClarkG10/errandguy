<?php

namespace App\Filament\Resources\PromoCodes;

use App\Filament\Resources\PromoCodes\Pages\CreatePromoCode;
use App\Filament\Resources\PromoCodes\Pages\EditPromoCode;
use App\Filament\Resources\PromoCodes\Pages\ListPromoCodes;
use App\Filament\Resources\PromoCodes\Schemas\PromoCodeForm;
use App\Filament\Resources\PromoCodes\Tables\PromoCodesTable;
use App\Models\AdminUser;
use App\Models\PromoCode;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Model;

class PromoCodeResource extends Resource
{
    protected static ?string $model = PromoCode::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedReceiptPercent;

    protected static string|\UnitEnum|null $navigationGroup = 'Money';

    protected static ?int $navigationSort = 30;

    protected static ?string $recordTitleAttribute = 'code';

    public static function form(Schema $schema): Schema
    {
        return PromoCodeForm::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return PromoCodesTable::configure($table);
    }

    public static function getRelations(): array
    {
        return [];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListPromoCodes::route('/'),
            'create' => CreatePromoCode::route('/create'),
            'edit' => EditPromoCode::route('/{record}/edit'),
        ];
    }

    // --- Authorization: finance may view; only super_admin/admin may mutate ---

    public static function canViewAny(): bool
    {
        return auth('admin')->user()?->hasAnyRole(
            AdminUser::ROLE_SUPER_ADMIN,
            AdminUser::ROLE_ADMIN,
            AdminUser::ROLE_FINANCE,
        ) ?? false;
    }

    protected static function canMutate(): bool
    {
        return auth('admin')->user()?->hasAnyRole(
            AdminUser::ROLE_SUPER_ADMIN,
            AdminUser::ROLE_ADMIN,
        ) ?? false;
    }

    public static function canCreate(): bool
    {
        return static::canMutate();
    }

    public static function canEdit(Model $record): bool
    {
        return static::canMutate();
    }

    public static function canDelete(Model $record): bool
    {
        return static::canMutate();
    }
}
