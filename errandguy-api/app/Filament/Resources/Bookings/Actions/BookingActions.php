<?php

namespace App\Filament\Resources\Bookings\Actions;

use App\Enums\BookingStatus;
use App\Filament\Support\AdminNotify;
use App\Models\AdminUser;
use App\Models\Booking;
use Filament\Actions\Action;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Support\Icons\Heroicon;

/**
 * Staff decisions on an errand, built once and mounted both on the bookings
 * list row and in the errand page's header — the page is where staff read
 * what happened (alerts, search and links all land there), so they can act
 * without going back to the list to re-find the row. A table action is handed
 * the row's record and a page header action the page's record, so the role
 * gates are shared by construction. (Pattern: SupportTicketActions.)
 */
class BookingActions
{
    /** @return array<int, Action> */
    public static function all(): array
    {
        return [
            self::cancel(),
            self::rematch(),
            self::returnToMatching(),
            self::markCompleted(),
        ];
    }

    public static function cancel(): Action
    {
        return Action::make('cancel')
            ->label('Cancel booking')
            ->icon(Heroicon::OutlinedXCircle)
            ->color('danger')
            ->requiresConfirmation()
            ->modalDescription(fn (Booking $record): string => 'Cancels booking '
                .$record->booking_number.' for '.($record->customer?->full_name ?? 'the customer').'. '
                .\App\Services\BookingService::cancelNotice($record)
                .' This can’t be undone.')
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
            });
    }

    public static function rematch(): Action
    {
        return Action::make('rematch')
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
            });
    }

    /**
     * Stuck-errand rescue: the runner accepted but can't (or won't) finish.
     * Take it off them and offer it to someone else.
     */
    public static function returnToMatching(): Action
    {
        return Action::make('returnToMatching')
            ->label('Return to matching')
            ->icon(Heroicon::OutlinedArrowUturnLeft)
            ->color('warning')
            ->requiresConfirmation()
            ->modalHeading('Return this errand to matching')
            ->modalDescription(fn (Booking $record): string => 'Takes '.$record->booking_number.' off '
                .($record->runner?->full_name ?? 'its runner').' and offers it to another runner, with a fresh search. '
                .'Both the runner and the customer are told. '
                .'If the runner already has the customer’s item, arrange the handover first.'
                .((float) $record->actual_item_cost > 0
                    ? ' '.($record->runner?->full_name ?? 'The runner').' already paid ₱'
                        .number_format((float) $record->actual_item_cost, 2)
                        .' for the customer’s items and is owed it — an alert is raised so it gets settled; '
                        .'the customer repays the new runner.'
                    : ''))
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
            });
    }

    /**
     * Stuck-errand rescue: the work was done but the runner can't finish it in
     * the app. Settles exactly like their own completion
     * (BookingService::adminMarkCompleted). It pays the runner, so it is for
     * money roles only.
     */
    public static function markCompleted(): Action
    {
        return Action::make('markCompleted')
            ->label('Mark completed')
            ->icon(Heroicon::OutlinedCheckCircle)
            ->color('success')
            ->requiresConfirmation()
            ->modalHeading('Mark this errand completed')
            ->modalDescription(fn (Booking $record): string => 'Completes '.$record->booking_number
                .' on behalf of '.($record->runner?->full_name ?? 'its runner')
                .' and settles it like a normal completion. '
                .\App\Services\BookingService::completionPayoutNotice($record)
                .' Use only when the errand was actually done. This can’t be undone.')
            ->schema([
                Textarea::make('reason')->required()->maxLength(500),
            ])
            ->visible(fn ($record): bool => self::isRescuable($record, moneyAction: true))
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
                    note: \App\Services\BookingService::completionPayoutNotice($record->fresh() ?? $record),
                );
            });
    }

    /**
     * A runner accepted it and hasn't finished — the errands the two rescue
     * actions apply to. Returning it to matching is for super admin / admin /
     * ops; marking it completed pays the runner, so it is for the money roles
     * (super admin / finance).
     */
    public static function isRescuable(Booking $record, bool $moneyAction = false): bool
    {
        $staff = auth('admin')->user();

        return $record->runner_id !== null
            && in_array($record->status, BookingStatus::IN_PROGRESS, true)
            && ($moneyAction
                ? ($staff?->canManageMoney() ?? false)
                : ($staff?->hasAnyRole(
                    AdminUser::ROLE_SUPER_ADMIN,
                    AdminUser::ROLE_ADMIN,
                    AdminUser::ROLE_OPS,
                ) ?? false));
    }
}
