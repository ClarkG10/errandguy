<?php

namespace App\Filament\Resources\Bookings;

use App\Filament\Resources\Bookings\Pages\ListBookings;
use App\Filament\Resources\Bookings\Pages\ViewBooking;
use App\Filament\Resources\Bookings\Schemas\BookingInfolist;
use App\Filament\Resources\Bookings\Tables\BookingsTable;
use App\Models\Booking;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class BookingResource extends Resource
{
    protected static ?string $model = Booking::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedClipboardDocumentList;

    protected static string|\UnitEnum|null $navigationGroup = 'Operations';

    protected static ?int $navigationSort = 10;

    protected static ?string $recordTitleAttribute = 'booking_number';

    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()->with(['customer', 'runner', 'errandType']);
    }

    public static function infolist(Schema $schema): Schema
    {
        return BookingInfolist::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return BookingsTable::configure($table);
    }

    public static function getRelations(): array
    {
        return [
            RelationManagers\ReviewsRelationManager::class,
        ];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListBookings::route('/'),
            'view' => ViewBooking::route('/{record}/view'),
        ];
    }

    /** Global search (top bar): find bookings by their number. */
    public static function getGloballySearchableAttributes(): array
    {
        return ['booking_number'];
    }

    // --- Authorization: any signed-in admin can browse; view-only fields ---

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
