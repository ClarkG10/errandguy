<?php

namespace App\Filament\Resources\DisputeTickets;

use App\Filament\Resources\DisputeTickets\Pages\ListDisputeTickets;
use App\Filament\Resources\DisputeTickets\Pages\ViewDisputeTicket;
use App\Filament\Resources\DisputeTickets\Schemas\DisputeTicketInfolist;
use App\Filament\Resources\DisputeTickets\Tables\DisputeTicketsTable;
use App\Models\DisputeTicket;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class DisputeTicketResource extends Resource
{
    protected static ?string $model = DisputeTicket::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedExclamationTriangle;

    protected static string|\UnitEnum|null $navigationGroup = 'Safety & Support';

    protected static ?int $navigationSort = 20;

    public static function infolist(Schema $schema): Schema
    {
        return DisputeTicketInfolist::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return DisputeTicketsTable::configure($table);
    }

    /**
     * One query per relation for the whole page — never one per row.
     *
     * `completedPayment` + `resolvedBy` are eager loads (the Amount / Paid-via
     * columns and the "Resolved by" name), and `is_refundable` is a single
     * EXISTS subselect on the same statement so the refund gate costs nothing
     * extra. The view page resolves its record through here too
     * (resolveRecordRouteBinding), so the header actions see the same flag.
     */
    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()
            ->with(['booking', 'reporter', 'completedPayment', 'resolvedBy'])
            ->withExists(['refundablePayments as is_refundable']);
    }

    public static function getRelations(): array
    {
        return [];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListDisputeTickets::route('/'),
            'view' => ViewDisputeTicket::route('/{record}/view'),
        ];
    }

    public static function getNavigationBadge(): ?string
    {
        $n = \App\Support\AdminCache::remember(
            \App\Support\AdminCache::BADGE_DISPUTES,
            fn () => DisputeTicket::unresolved()->count(),
        );

        return $n ? (string) $n : null;
    }

    public static function getNavigationBadgeColor(): ?string
    {
        return 'warning';
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
