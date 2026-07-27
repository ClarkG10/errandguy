<?php

namespace App\Filament\Resources\Payments\Tables;

use App\Support\AdminActivity;
use Filament\Actions\Action;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Notifications\Notification;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class PaymentsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('booking.booking_number')
                    ->label('Booking')
                    ->searchable(),
                TextColumn::make('customer.full_name')
                    ->searchable(),
                TextColumn::make('amount')
                    ->money('PHP')
                    ->sortable(),
                TextColumn::make('method')
                    ->badge()
                    ->toggleable(),
                TextColumn::make('status')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'completed' => 'success',
                        'pending', 'processing' => 'warning',
                        'failed', 'cancelled', 'expired' => 'danger',
                        'refunded' => 'info',
                        default => 'gray',
                    }),
                TextColumn::make('paid_at')
                    ->dateTime()
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('refund_amount')
                    ->money('PHP')
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('created_at')
                    ->dateTime()
                    ->sortable(),
            ])
            ->filters([
                SelectFilter::make('status')
                    ->options([
                        'pending' => 'Pending',
                        'processing' => 'Processing',
                        'completed' => 'Completed',
                        'failed' => 'Failed',
                        'expired' => 'Expired',
                        'cancelled' => 'Cancelled',
                        'refunded' => 'Refunded',
                    ]),
                SelectFilter::make('method')
                    ->options([
                        'wallet' => 'Wallet',
                        'gcash' => 'GCash',
                        'maya' => 'Maya',
                        'card' => 'Card',
                        'cash' => 'Cash',
                    ]),
            ])
            ->recordActions([
                ViewAction::make(),
                Action::make('refund')
                    ->label('Refund')
                    ->icon(Heroicon::OutlinedBanknotes)
                    ->color('warning')
                    // Money-critical gate: a refund is only legal from a COMPLETED
                    // payment, and only finance/super_admin may issue it.
                    ->visible(fn ($record): bool => $record->status === 'completed'
                        && (auth('admin')->user()?->canManageMoney() ?? false))
                    ->schema([
                        TextInput::make('amount')
                            ->numeric()
                            ->prefix('₱')
                            ->helperText('Leave blank for full refund.'),
                        Textarea::make('reason')
                            ->default('REQUESTED_BY_CUSTOMER')
                            ->required(),
                    ])
                    ->action(function (array $data, $record): void {
                        try {
                            app(\App\Services\PaymentService::class)->refundPayment(
                                $record->id,
                                $data['amount'] !== null && $data['amount'] !== '' ? (float) $data['amount'] : null,
                                $data['reason'],
                            );
                            AdminActivity::log('payment.refunded', $record, [
                                'amount' => $data['amount'],
                                'reason' => $data['reason'],
                            ]);
                            Notification::make()->title('Refund submitted')->success()->send();
                        } catch (\Throwable $e) {
                            Notification::make()->title('Refund failed')->body($e->getMessage())->danger()->send();
                        }
                    }),
            ]);
    }
}
