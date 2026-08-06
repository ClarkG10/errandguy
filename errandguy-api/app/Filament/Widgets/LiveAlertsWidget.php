<?php

namespace App\Filament\Widgets;

use App\Filament\Resources\Bookings\BookingResource;
use App\Filament\Resources\SOSAlerts\SOSAlertResource;
use App\Models\AdminAlert;
use Filament\Actions\Action;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Filament\Widgets\TableWidget;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Schema;

/**
 * Live operator alert feed. The moment an SOS is pulled or an errand fails to
 * match, a row appears here (the table polls every 20s). Complements the
 * "Needs attention" count cards with the individual events + timestamps —
 * deep-linked to the record and dismissible. Backed by the dedicated
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

    public function table(Table $table): Table
    {
        return $table
            ->query(fn (): Builder => AdminAlert::query())
            ->defaultSort('created_at', 'desc')
            ->poll('20s')
            ->paginated([10, 25])
            ->emptyStateHeading('No alerts')
            ->emptyStateDescription('SOS and stuck-errand alerts will appear here as they happen.')
            ->columns([
                TextColumn::make('severity')
                    ->badge()
                    ->formatStateUsing(fn (string $state): string => ucfirst($state))
                    ->color(fn (string $state): string => match ($state) {
                        'critical' => 'danger',
                        'warning' => 'warning',
                        default => 'gray',
                    }),
                TextColumn::make('title')
                    ->weight('semibold')
                    ->description(fn (AdminAlert $record): ?string => $record->body)
                    ->wrap(),
                TextColumn::make('created_at')->label('When')->since()->sortable(),
                IconColumn::make('read_at')->label('Seen')->boolean(),
            ])
            ->recordUrl(fn (AdminAlert $record): ?string => match ($record->type) {
                'sos' => $record->subject_id ? SOSAlertResource::getUrl('view', ['record' => $record->subject_id]) : null,
                'no_runner' => $record->subject_id ? BookingResource::getUrl('view', ['record' => $record->subject_id]) : null,
                default => null,
            })
            ->recordActions([
                Action::make('dismiss')
                    ->label('Dismiss')
                    ->icon(Heroicon::OutlinedCheck)
                    ->color('gray')
                    ->visible(fn (AdminAlert $record): bool => $record->read_at === null)
                    ->action(fn (AdminAlert $record) => $record->update(['read_at' => now()])),
            ]);
    }
}
