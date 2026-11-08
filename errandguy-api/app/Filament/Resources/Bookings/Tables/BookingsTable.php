<?php

namespace App\Filament\Resources\Bookings\Tables;

use App\Enums\BookingStatus;
use App\Filament\Resources\Bookings\Actions\BookingActions;
use App\Filament\Support\AdminNotify;
use App\Filament\Support\DateRangeFilter;
use App\Filament\Support\ExportCsv;
use App\Models\AdminUser;
use App\Models\Booking;
use Filament\Actions\Action;
use Filament\Actions\BulkAction;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\Summarizers\Sum;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Support\Collection;

class BookingsTable
{
    /**
     * Ceiling on a single bulk re-match. adminRematch dispatches offer jobs per
     * booking, so an unbounded selection would fan simultaneous offers out to
     * every runner in range at once.
     */
    private const REMATCH_BULK_LIMIT = 25;

    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('booking_number')->searchable()->sortable(),
                TextColumn::make('customer.full_name')->label('Customer')->searchable(),
                TextColumn::make('runner.full_name')->label('Runner')->placeholder('—')->searchable()
                    // runner_id is set at the offer: on an errand nobody
                    // accepted, the name is who it was offered to, not its runner.
                    ->description(fn (Booking $record): ?string => $record->runner_id && ! $record->accepted_at
                        && in_array($record->status, ['matched', 'cancelled', 'no_runner'], true)
                        ? 'Offered, not accepted'
                        : null),
                TextColumn::make('status')->formatStateUsing(fn (?string $state): string => \App\Filament\Support\StatusLabels::booking($state))
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'completed', 'delivered' => 'success',
                        'pending', 'matched', 'accepted', 'heading_to_pickup', 'arrived_at_pickup',
                        'picked_up', 'in_transit', 'arrived_at_dropoff' => 'warning',
                        'cancelled', 'no_runner' => 'danger',
                        default => 'gray',
                    }),
                TextColumn::make('payment_status')->formatStateUsing(fn (?string $state): string => \App\Filament\Support\StatusLabels::payment($state))
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'paid' => 'success',
                        'unpaid', 'pending' => 'warning',
                        'failed', 'expired' => 'danger',
                        'refunded' => 'info',
                        default => 'gray',
                    }),
                TextColumn::make('payment_method')->formatStateUsing(fn (?string $state): string => \App\Filament\Support\StatusLabels::method($state))->badge()->color('gray')
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('total_amount')->money('PHP')->sortable()
                    // GMV is completed-only everywhere else (AdminStatsOverview,
                    // RevenueChart, OperationsKpis). This footer summed ALL rows
                    // in the filtered set — and the table has no default status
                    // filter — so the first view an operator sees counted
                    // cancelled / no_runner / in-flight money (never transacted)
                    // as GMV. Scope the summarizer to completed to match the label.
                    // GMV is a money figure: money roles only.
                    ->summarize(
                        Sum::make('gmv')
                            ->money('PHP')
                            ->label('Total GMV')
                            ->query(fn (\Illuminate\Database\Query\Builder $query) => $query->where('status', 'completed'))
                            ->visible(fn (): bool => auth('admin')->user()?->canManageMoney() ?? false)
                    ),
                TextColumn::make('schedule_type')->badge()->color('gray')
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('created_at')->dateTime()->sortable(),
            ])
            ->filters([
                SelectFilter::make('status')->options(\App\Filament\Support\StatusLabels::BOOKING),
                SelectFilter::make('payment_status')->options(\App\Filament\Support\StatusLabels::PAYMENT),
                SelectFilter::make('payment_method')->options([
                    'wallet' => 'Wallet',
                    'gcash' => 'GCash',
                    'maya' => 'Maya',
                    'cash' => 'Cash',
                    // Retired; older bookings keep it.
                    'card' => 'Card (legacy)',
                ]),
                DateRangeFilter::make('created_at', 'Date placed'),
            ])
            ->headerActions([
                ExportCsv::make('bookings', [
                    'Booking' => fn (Booking $r): ?string => $r->booking_number,
                    'Status' => fn (Booking $r): ?string => $r->status,
                    'Payment status' => fn (Booking $r): ?string => $r->payment_status,
                    'Payment method' => fn (Booking $r): ?string => $r->payment_method,
                    'Customer' => fn (Booking $r): ?string => $r->customer?->full_name,
                    'Runner' => fn (Booking $r): ?string => $r->runner?->full_name,
                    'Total (PHP)' => fn (Booking $r) => $r->total_amount,
                    // Runner earnings are for the money roles only.
                    ...((auth('admin')->user()?->canManageMoney() ?? false)
                        ? ['Runner payout (PHP)' => fn (Booking $r) => $r->runner_payout]
                        : []),
                    'Placed' => fn (Booking $r) => $r->created_at,
                    'Completed' => fn (Booking $r) => $r->completed_at,
                ]),
            ])
            ->toolbarActions([
                // Clear a batch of stranded errands in one pass. A surge or a
                // matching hiccup strands them together, and re-running
                // matching was a per-row modal — open, confirm, repeat, with a
                // customer waiting behind every row.
                //
                // Capped deliberately: adminRematch dispatches offer jobs per
                // booking, so an unbounded selection would fan out simultaneous
                // offers to every runner in range at once. Rows that have since
                // been taken or cancelled are counted as skipped, never
                // aborting the rest of the batch.
                BulkAction::make('rematchSelected')
                    ->label('Re-run matching for selected')
                    ->icon(Heroicon::OutlinedArrowPathRoundedSquare)
                    ->color('warning')
                    ->requiresConfirmation()
                    ->modalHeading('Re-run matching for the selected errands')
                    ->modalDescription('Sends fresh offers to nearby runners for every selected errand still awaiting one. Rows that already have a runner, are no longer live, were refunded, or are scheduled for later are skipped. Limited to '.self::REMATCH_BULK_LIMIT.' at a time.')
                    ->schema([
                        TextInput::make('radius_km')
                            ->label('Search radius (km, optional)')
                            ->helperText('Applied to every selected errand. Leave blank for the default.')
                            ->numeric()
                            ->minValue(1)
                            ->maxValue(50),
                    ])
                    ->visible(fn (): bool => auth('admin')->user()?->hasAnyRole(
                        AdminUser::ROLE_SUPER_ADMIN,
                        AdminUser::ROLE_ADMIN,
                        AdminUser::ROLE_OPS,
                    ) ?? false)
                    ->deselectRecordsAfterCompletion()
                    ->action(function (array $data, Collection $records): void {
                        $radiusKm = isset($data['radius_km']) && $data['radius_km'] !== null && $data['radius_km'] !== ''
                            ? (float) $data['radius_km']
                            : null;

                        if ($records->count() > self::REMATCH_BULK_LIMIT) {
                            AdminNotify::warning(
                                'Too many errands selected',
                                'Select at most '.self::REMATCH_BULK_LIMIT.' so offers do not all fan out at once.',
                            );

                            return;
                        }

                        $sent = 0;
                        $skipped = 0;
                        $failed = 0;
                        $service = app(\App\Services\BookingService::class);

                        foreach ($records as $record) {
                            if (! in_array($record->status, ['no_runner', 'pending'], true)) {
                                $skipped++;
                                continue;
                            }

                            try {
                                $service->adminRematch($record->id, $radiusKm);
                                $sent++;
                            } catch (\App\Exceptions\BookingStateException) {
                                // Taken or cancelled between selection and now,
                                // refunded, or not due yet (adminRematch's guards).
                                $skipped++;
                            } catch (\Throwable $e) {
                                report($e);
                                $failed++;
                            }
                        }

                        $notes = [];
                        if ($skipped) {
                            $notes[] = "{$skipped} skipped (already matched, no longer live, refunded, or scheduled for later).";
                        }
                        if ($failed) {
                            $notes[] = "{$failed} failed — see logs.";
                        }

                        AdminNotify::success(
                            $sent.' errand'.($sent === 1 ? '' : 's').' re-matched',
                            note: $notes === [] ? 'Fresh offers are on their way to nearby runners.' : implode(' ', $notes),
                            audit: 'booking.rematch.bulk',
                            properties: ['count' => $sent, 'radius_km' => $radiusKm],
                        );
                    }),
                ExportCsv::bulk('bookings', [
                    'Booking' => fn (Booking $r): ?string => $r->booking_number,
                    'Status' => fn (Booking $r): ?string => $r->status,
                    'Customer' => fn (Booking $r): ?string => $r->customer?->full_name,
                    'Runner' => fn (Booking $r): ?string => $r->runner?->full_name,
                    'Total (PHP)' => fn (Booking $r) => $r->total_amount,
                    'Placed' => fn (Booking $r) => $r->created_at,
                ]),
            ])
            ->recordActions([
                ViewAction::make(),

                ...BookingActions::all(),
            ]);
    }
}
