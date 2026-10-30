<?php

namespace App\Filament\Resources\Bookings\Tables;

use App\Enums\BookingStatus;
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

                Action::make('cancel')
                    ->label('Cancel booking')
                    ->icon(Heroicon::OutlinedXCircle)
                    ->color('danger')
                    ->requiresConfirmation()
                    ->modalDescription(fn (Booking $record): string => 'Cancels booking '
                        .$record->booking_number.' for '.($record->customer?->full_name ?? 'the customer')
                        .'. This runs the cancellation/refund policy and can’t be undone.')
                    ->schema([
                        Textarea::make('reason')->required()->maxLength(500)
                            ->helperText('The customer sees this reason in the app and in their cancellation notice.'),
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
                        .$record->booking_number.'. Sends fresh offers to nearby runners — use only on a stuck errand with no runner assigned yet. Refused if its payment was refunded or hasn’t arrived yet, or it is scheduled for later.')
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

                // Stuck-errand rescue: the runner accepted but can't (or won't)
                // finish. Take it off them and offer it to someone else.
                Action::make('returnToMatching')
                    ->label('Return to matching')
                    ->icon(Heroicon::OutlinedArrowUturnLeft)
                    ->color('warning')
                    ->requiresConfirmation()
                    ->modalHeading('Return this errand to matching')
                    ->modalDescription(fn (Booking $record): string => 'Takes '.$record->booking_number.' off '
                        .($record->runner?->full_name ?? 'its runner').' and offers it to another runner. Both the runner and the customer are told. '
                        .'If the runner already has the customer’s item, arrange the handover first.')
                    ->schema([
                        Textarea::make('reason')->required()->maxLength(500),
                    ])
                    ->visible(fn ($record): bool => self::isRescuable($record))
                    ->action(function (array $data, $record): void {
                        $runnerName = $record->runner?->full_name;

                        try {
                            app(\App\Services\BookingService::class)
                                ->adminReturnToMatching($record->id, $data['reason']);
                        } catch (\App\Exceptions\BookingStateException $e) {
                            AdminNotify::error('Could not return the errand to matching', $e, $record, [
                                'Booking' => $record->booking_number,
                            ]);

                            return;
                        }

                        AdminNotify::success(
                            'Errand returned to matching',
                            $record,
                            context: [
                                'Booking' => $record->booking_number,
                                'Removed runner' => $runnerName,
                            ],
                            audit: 'booking.returned_to_matching',
                            properties: ['reason' => $data['reason'], 'runner' => $runnerName],
                            note: 'Offers are going out to other runners.',
                        );
                    }),

                // Stuck-errand rescue: the work was done but the runner can't
                // finish it in the app. Settles exactly like their own
                // completion (BookingService::adminMarkCompleted).
                Action::make('markCompleted')
                    ->label('Mark completed')
                    ->icon(Heroicon::OutlinedCheckCircle)
                    ->color('success')
                    ->requiresConfirmation()
                    ->modalHeading('Mark this errand completed')
                    ->modalDescription(fn (Booking $record): string => 'Completes '.$record->booking_number
                        .' on behalf of '.($record->runner?->full_name ?? 'its runner')
                        .' and settles it like a normal completion: the runner is paid and the payment is recorded. '
                        .'Use only when the errand was actually done. This can’t be undone.')
                    ->schema([
                        Textarea::make('reason')->required()->maxLength(500),
                    ])
                    ->visible(fn ($record): bool => self::isRescuable($record))
                    ->action(function (array $data, $record): void {
                        try {
                            app(\App\Services\BookingService::class)
                                ->adminMarkCompleted($record->id, auth('admin')->id(), $data['reason']);
                        } catch (\App\Exceptions\BookingStateException $e) {
                            AdminNotify::error('Could not mark the errand completed', $e, $record, [
                                'Booking' => $record->booking_number,
                            ]);

                            return;
                        }

                        AdminNotify::success(
                            'Errand marked completed',
                            $record,
                            context: [
                                'Booking' => $record->booking_number,
                                'Runner' => $record->runner?->full_name,
                            ],
                            audit: 'booking.marked_completed',
                            properties: ['reason' => $data['reason']],
                            note: 'The runner has been paid for it.',
                        );
                    }),
            ]);
    }

    /**
     * A runner accepted it and hasn't finished — the errands the two rescue
     * actions apply to (super admin / admin / ops only).
     */
    private static function isRescuable(Booking $record): bool
    {
        return $record->runner_id !== null
            && in_array($record->status, BookingStatus::IN_PROGRESS, true)
            && (auth('admin')->user()?->hasAnyRole(
                AdminUser::ROLE_SUPER_ADMIN,
                AdminUser::ROLE_ADMIN,
                AdminUser::ROLE_OPS,
            ) ?? false);
    }
}
