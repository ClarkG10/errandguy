<?php

namespace App\Filament\Resources\Bookings\Tables;

use App\Filament\Support\DateRangeFilter;
use App\Filament\Support\ExportCsv;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Support\AdminActivity;
use Filament\Actions\Action;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\Textarea;
use Filament\Notifications\Notification;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class BookingsTable
{
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
                TextColumn::make('total_amount')->money('PHP')->sortable(),
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
            ->recordActions([
                ViewAction::make(),

                Action::make('cancel')
                    ->label('Cancel booking')
                    ->icon(Heroicon::OutlinedXCircle)
                    ->color('danger')
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
                            Notification::make()->title($e->getMessage())->danger()->send();

                            return;
                        }

                        AdminActivity::log('booking.cancelled', $record, ['reason' => $data['reason']]);

                        Notification::make()->title('Booking cancelled')->success()->send();
                    }),
            ]);
    }
}
