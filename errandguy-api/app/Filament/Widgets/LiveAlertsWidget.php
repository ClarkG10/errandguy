<?php

namespace App\Filament\Widgets;

use App\Filament\Pages\Payouts;
use App\Filament\Resources\Bookings\BookingResource;
use App\Filament\Resources\SOSAlerts\SOSAlertResource;
use App\Filament\Resources\Users\UserResource;
use App\Models\AdminAlert;
use App\Services\StaffMoneyLimit;
use Filament\Actions\Action;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Filament\Widgets\TableWidget;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Schema;

/**
 * Live operator alert feed. The moment an SOS is pulled, an errand fails to
 * match or a background task fails for good, a row appears here (the table
 * polls every 20s). Complements the "Needs attention" count cards with the
 * individual events + timestamps — deep-linked to the record (when the viewer
 * can open it) and dismissible. Backed by the dedicated
 * admin_alerts table (kept separate from the customer `notifications` table).
 */
class LiveAlertsWidget extends TableWidget
{
    protected static ?int $sort = 1; // above the ActionQueue counts (sort 2)

    protected static ?string $heading = 'Live alerts';

    protected int|string|array $columnSpan = 'full';

    public static function canView(): bool
    {
        // Deploy-safety: this widget queries admin_alerts, so hide it until the
        // migration has run — otherwise the dashboard would 500 before migrate.
        return Schema::hasTable('admin_alerts');
    }

    /** Alerts about staff moving money by hand: for money roles only. */
    private const MONEY_ROLE_TYPES = [StaffMoneyLimit::ALERT_ADJUSTMENT, StaffMoneyLimit::ALERT_PAYOUT];

    public function table(Table $table): Table
    {
        $canSeeMoney = auth('admin')->user()?->canManageMoney() ?? false;

        return $table
            ->query(fn (): Builder => AdminAlert::query()
                ->when(! $canSeeMoney, fn (Builder $q) => $q->whereNotIn('type', self::MONEY_ROLE_TYPES)))
            ->defaultSort('created_at', 'desc')
            ->poll('20s')
            ->paginated([10, 25])
            ->emptyStateHeading('No alerts')
            ->emptyStateDescription('SOS and stuck-errand alerts will appear here as they happen.')
            ->columns([
                TextColumn::make('severity')
                    ->badge()
                    ->formatStateUsing(fn (string $state): string => ucfirst($state))
                    ->color(fn (string $state): string => self::severityColor($state)),
                TextColumn::make('title')
                    ->weight('semibold')
                    ->description(fn (AdminAlert $record): ?string => $record->body)
                    ->wrap(),
                TextColumn::make('created_at')->label('When')->since()->sortable(),
                IconColumn::make('read_at')->label('Seen')->boolean(),
            ])
            ->recordUrl(fn (AdminAlert $record): ?string => self::linkFor($record))
            ->recordActions([
                Action::make('dismiss')
                    ->label('Dismiss')
                    ->icon(Heroicon::OutlinedCheck)
                    ->color('gray')
                    ->visible(fn (AdminAlert $record): bool => $record->read_at === null)
                    ->action(fn (AdminAlert $record) => $record->update(['read_at' => now()])),
            ]);
    }

    /** 'error' is a background task that failed for good (JobFailureReporter) — as red as a critical. */
    public static function severityColor(string $severity): string
    {
        return match ($severity) {
            'critical', 'error' => 'danger',
            'warning' => 'warning',
            default => 'gray',
        };
    }

    /**
     * Where an alert's row leads — only to a page the viewer's role can open;
     * otherwise the row isn't a link.
     */
    public static function linkFor(AdminAlert $record): ?string
    {
        return match ($record->type) {
            'sos', 'sos_delivery' => $record->subject_id && SOSAlertResource::canViewAny()
                ? SOSAlertResource::getUrl('view', ['record' => $record->subject_id])
                : null,
            // Every booking-subject alert deep-links to the booking — the
            // operator's whole job on these rows is to open it. The stall
            // monitor passes the booking id.
            'no_runner', 'stalled_errand' => $record->subject_id && BookingResource::canViewAny()
                ? BookingResource::getUrl('view', ['record' => $record->subject_id])
                : null,
            // A large wallet adjustment: the user whose wallet it was.
            StaffMoneyLimit::ALERT_ADJUSTMENT => $record->subject_id && UserResource::canViewAny()
                ? UserResource::getUrl('view', ['record' => $record->subject_id])
                : null,
            // Payout alerts are worked on the Payouts page.
            'payout_paid_after_failed', 'payout_bounced_deleted_account', 'payout_reconciled',
            StaffMoneyLimit::ALERT_PAYOUT => Payouts::canAccess() ? Payouts::getUrl() : null,
            default => null,
        };
    }
}
