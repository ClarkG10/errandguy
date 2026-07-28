<?php

namespace App\Filament\Resources\Payments\Tables;

use App\Support\AdminActivity;
use Filament\Actions\Action;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\Textarea;
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
                    ->requiresConfirmation()
                    // Full refund only (partial awaits the P2 refunds ledger).
                    // Finance/super_admin only, completed payments only.
                    ->visible(fn ($record): bool => $record->status === 'completed'
                        && (auth('admin')->user()?->canManageMoney() ?? false))
                    ->modalDescription(fn ($record): string => match (true) {
                        $record->method === 'card' => 'Full refund reversed to the original card via Xendit.',
                        $record->method === 'cash' => 'Cash is settled with the runner directly — this cannot be refunded here.',
                        default => 'Full refund to the customer\'s ErrandGuy wallet.',
                    })
                    ->schema([
                        Textarea::make('reason')
                            ->default('REQUESTED_BY_CUSTOMER')
                            ->required()
                            ->maxLength(500),
                    ])
                    ->action(function (array $data, $record): void {
                        try {
                            $service = app(\App\Services\PaymentService::class);
                            // Hybrid: card reverses to source; wallet/GCash/Maya go to
                            // the wallet; cash is rejected by the service (never held).
                            if ($record->method === 'card') {
                                if (blank($record->gateway_tx_id)) {
                                    throw new \RuntimeException('This card payment has no gateway reference to reverse.');
                                }
                                $service->refundPayment($record->id, null, $data['reason']);
                            } else {
                                $service->refundToWallet($record->id, $data['reason']);
                            }
                            AdminActivity::log('payment.refunded', $record, [
                                'method' => $record->method,
                                'amount' => 'full',
                                'reason' => $data['reason'],
                            ]);
                            Notification::make()->title('Refund processed')->success()->send();
                        } catch (\Throwable $e) {
                            Notification::make()->title('Refund failed')->body($e->getMessage())->danger()->send();
                        }
                    }),
            ]);
    }
}
