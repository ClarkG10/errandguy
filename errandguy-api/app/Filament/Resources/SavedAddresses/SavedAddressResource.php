<?php

namespace App\Filament\Resources\SavedAddresses;

use App\Filament\Resources\SavedAddresses\Pages\ListSavedAddresses;
use App\Filament\Resources\SavedAddresses\Pages\ViewSavedAddress;
use App\Filament\Resources\SavedAddresses\Schemas\SavedAddressInfolist;
use App\Filament\Resources\SavedAddresses\Tables\SavedAddressesTable;
use App\Models\SavedAddress;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class SavedAddressResource extends Resource
{
    protected static ?string $model = SavedAddress::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedMapPin;

    protected static string|\UnitEnum|null $navigationGroup = 'People';

    protected static ?int $navigationSort = 40;

    protected static ?string $recordTitleAttribute = 'label';

    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()->with('user:id,full_name,phone');
    }

    public static function infolist(Schema $schema): Schema
    {
        return SavedAddressInfolist::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return SavedAddressesTable::configure($table);
    }

    public static function getRelations(): array
    {
        return [];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListSavedAddresses::route('/'),
            'view' => ViewSavedAddress::route('/{record}/view'),
        ];
    }

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
