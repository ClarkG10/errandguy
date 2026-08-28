<?php

namespace App\Filament\Resources\Bookings\Tables;

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
                TextColumn::make('runner.full_name')->label('Runner')->placeholder('—'),
                TextColumn::make('status')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'completed', 'delivered' => 'success',
                        'pending', 'matched', 'accepted', 'heading_to_pickup', 'arrived_at_pickup',
                        'picked_up', 'in_transit', 'arrived_at_dropoff' => 'warning',
                        'cancelled', 'no_runner' => 'danger',
                        default => 'gray',
                    }),
                TextColumn::make('payment_status')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'paid' => 'success',
                        'unpaid', 'pending' => 'warning',
                        'failed', 'expired' => 'danger',
                        'refunded' => 'info',
                        default => 'gray',
                    }),
                TextColumn::make('payment_method')->badge()->color('gray')
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('total_amount')->money('PHP')->sortable()
                    // GMV is completed-only everywhere else (AdminStatsOverview,
                    // RevenueChart, OperationsKpis). This footer summed ALL rows
                    // in the filtered set — and the table has no default status
                    // filter — so the first view an operator sees counted
                    // cancelled / no_runner / in-flight money (never transacted)
                    // as GMV. Scope the summarizer to completed to match the label.
                    ->summarize(
                        Sum::make('gmv')
                            ->money('PHP')
                            ->label('Total GMV')
                            ->query(fn (\Illuminate\Database\Query\Builder $query) => $query->where('status', 'completed'))
                    ),
                TextColumn::make('schedule_type')->badge()->color('gray')
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('created_at')->dateTime()->sortable(),
            ])
            ->filters([
                SelectFilter::make('status')->options([
                    'pending' => 'Pending',
                    'matched' => 'Matched',
                    'accepted' => 'Accepted',
                    'heading_to_pickup' => 'Heading to pickup',
                    'arrived_at_pickup' => 'Arrived at pickup',
                    'picked_up' => 'Picked up',
                    'in_transit' => 'In transit',
                    'arrived_at_dropoff' => 'Arrived at dropoff',
                    'delivered' => 'Delivered',
                    'completed' => 'Completed',
                    'cancelled' => 'Cancelled',
                    'no_runner' => 'No runner',
                ]),
                SelectFilter::make('payment_status')->options([
                    'unpaid' => 'Unpaid',
                    'pending' => 'Pending',
                    'paid' => 'Paid',
                    'refunded' => 'Refunded',
                    'failed' => 'Failed',
                    'expired' => 'Expired',
                ]),
                SelectFilter::make('payment_method')->options([
                    'wallet' => 'Wallet',
                    'gcash' => 'GCash',
                    'maya' => 'Maya',
                    'card' => 'Card',
                    'cash' => 'Cash',
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
                    'Runner payout (PHP)' => fn (Booking $r) => $r->runner_payout,
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
                    ->modalDescription('Sends fresh offers to nearby runners for every selected errand still awaiting one. Rows that already have a runner, or are no longer live, are skipped. Limited to '.self::REMATCH_BULK_LIMIT.' at a time.')
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
                                // Taken or cancelled between selection and now.
                                $skipped++;
                            } catch (\Throwable $e) {
                                report($e);
                                $failed++;
                            }
                        }

                        $notes = [];
                        if ($skipped) {
                            $notes[] = "{$skipped} skipped (already matched, or no longer live).";
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

                Action::make('cancel')
                    ->label('Cancel booking')
                    ->icon(Heroicon::OutlinedXCircle)
                    ->color('danger')
                    ->requiresConfirmation()
                    ->modalDescription(fn (Booking $record): string => 'Cancels booking '
                        .$record->booking_number.' for '.($record->customer?->full_name ?? 'the customer')
                        .'. This runs the cancellation/refund policy and can’t be undone.')
                    ->schema([
                        Textarea::make('reason')->required()->maxLength(500),
                    ])
                    ->visible(fn ($record): bool => ! in_array($record->status, ['completed', 'cancelled'], true)
                        && (auth('admin')->user()?->hasAnyRole(
                            AdminUser::ROLE_SUPER_ADMIN,
                            AdminUser::ROLE_ADMIN,
                            AdminUser::ROLE_OPS,
                        ) ?? false))
                    ->action(function (array $data, $record): void {
                        try {
                            app(\App\Services\BookingService::class)
                                ->adminCancel($record->id, auth('admin')->id(), $data['reason']);
                        } catch (\App\Exceptions\BookingStateException $e) {
                            AdminNotify::error('Could not cancel booking', $e, $record, [
                                'Booking' => $record->booking_number,
                            ]);

                            return;
                        }

                        AdminNotify::success(
                            'Booking cancelled',
                            $record,
                            context: [
                                'Booking' => $record->booking_number,
                                'Customer' => $record->customer?->full_name,
                            ],
                            audit: 'booking.cancelled',
                            properties: ['reason' => $data['reason']],
                        );
                    }),

                Action::make('rematch')
                    ->label('Re-run matching')
                    ->icon(Heroicon::OutlinedArrowPathRoundedSquare)
                    ->color('warning')
                    ->requiresConfirmation()
                    ->modalDescription(fn (Booking $record): string => 'Re-runs runner matching for '
                        .$record->booking_number.'. Sends fresh offers to nearby runners — use only on a stuck errand with no runner assigned yet.')
                    ->schema([
                        TextInput::make('radius_km')
                            ->label('Search radius (km, optional)')
                            ->helperText('Leave blank for the default. Widen it if no runner was found nearby.')
                            ->numeric()
                            ->minValue(1)
                            ->maxValue(50),
                    ])
                    ->visible(fn ($record): bool => in_array($record->status, ['no_runner', 'pending'], true)
                        && (auth('admin')->user()?->hasAnyRole(
                            AdminUser::ROLE_SUPER_ADMIN,
                            AdminUser::ROLE_ADMIN,
                            AdminUser::ROLE_OPS,
                        ) ?? false))
                    ->action(function (array $data, $record): void {
                        $radiusKm = isset($data['radius_km']) && $data['radius_km'] !== null && $data['radius_km'] !== ''
                            ? (float) $data['radius_km']
                            : null;

                        try {
                            app(\App\Services\BookingService::class)
                                ->adminRematch($record->id, $radiusKm);
                        } catch (\App\Exceptions\BookingStateException $e) {
                            AdminNotify::error('Could not re-run matching', $e, $record, [
                                'Booking' => $record->booking_number,
                            ]);

                            return;
                        }

                        AdminNotify::success(
                            'Matching re-run',
                            $record,
                            context: [
                                'Booking' => $record->booking_number,
                                'Customer' => $record->customer?->full_name,
                            ],
                            audit: 'booking.rematch',
                            properties: ['radius_km' => $radiusKm],
                        );
                    }),
            ]);
    }
}
