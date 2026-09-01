<?php

namespace App\Filament\Resources\SupportTickets;

use App\Filament\Resources\SupportTickets\Pages\ListSupportTickets;
use App\Filament\Resources\SupportTickets\Pages\ViewSupportTicket;
use App\Filament\Resources\SupportTickets\RelationManagers\MessagesRelationManager;
use App\Filament\Resources\SupportTickets\Schemas\SupportTicketInfolist;
use App\Filament\Resources\SupportTickets\Tables\SupportTicketsTable;
use App\Models\SupportTicket;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class SupportTicketResource extends Resource
{
    protected static ?string $model = SupportTicket::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedChatBubbleLeftRight;

    protected static string|\UnitEnum|null $navigationGroup = 'Safety & Support';

    protected static ?int $navigationSort = 30;

    protected static ?string $recordTitleAttribute = 'subject';

    public static function infolist(Schema $schema): Schema
    {
        return SupportTicketInfolist::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return SupportTicketsTable::configure($table);
    }

    /**
     * latestMessage is a latestOfMany HasOne, so "who spoke last" costs ONE
     * extra query for the whole page instead of a thread load per row.
     */
    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()->with(['user', 'latestMessage']);
    }

    public static function getRelations(): array
    {
        return [
            MessagesRelationManager::class,
        ];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListSupportTickets::route('/'),
            'view' => ViewSupportTicket::route('/{record}/view'),
        ];
    }

    public static function getGloballySearchableAttributes(): array
    {
        return ['subject'];
    }

    /**
     * Everything waiting on US, not just everything 'open'.
     *
     * An agent reply moves the ticket to 'pending'; the customer's answer leaves
     * the status alone, so a status='open' badge silently omitted every ticket a
     * customer had already replied to — the agent only found them by opening
     * each pending ticket in turn. SupportTicket::needsReply() is the shared
     * predicate (see the "Waiting on us" tab, which uses the same scope), and it
     * is a strict superset of the old count, so nothing that used to show
     * disappears. Cached under the same key, flushed by AdminActivity::log.
     */
    public static function getNavigationBadge(): ?string
    {
        $n = \App\Support\AdminCache::remember(
            \App\Support\AdminCache::BADGE_SUPPORT,
            fn () => SupportTicket::needsReply()->count(),
        );

        return $n ? (string) $n : null;
    }

    public static function getNavigationBadgeColor(): ?string
    {
        return 'warning';
    }

    // --- Authorization: support roles only ---

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
