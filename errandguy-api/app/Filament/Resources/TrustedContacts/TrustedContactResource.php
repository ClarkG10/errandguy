<?php

namespace App\Filament\Resources\TrustedContacts;

use App\Filament\Resources\TrustedContacts\Pages\ListTrustedContacts;
use App\Filament\Resources\TrustedContacts\Pages\ViewTrustedContact;
use App\Filament\Resources\TrustedContacts\Schemas\TrustedContactInfolist;
use App\Filament\Resources\TrustedContacts\Tables\TrustedContactsTable;
use App\Models\TrustedContact;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class TrustedContactResource extends Resource
{
    protected static ?string $model = TrustedContact::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedUserCircle;

    protected static string|\UnitEnum|null $navigationGroup = 'People';

    protected static ?int $navigationSort = 30;

    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()->with(['user']);
    }

    public static function infolist(Schema $schema): Schema
    {
        return TrustedContactInfolist::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return TrustedContactsTable::configure($table);
    }

    public static function getRelations(): array
    {
        return [];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListTrustedContacts::route('/'),
            'view' => ViewTrustedContact::route('/{record}/view'),
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
