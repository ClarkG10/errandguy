<?php

namespace App\Filament\Resources\Payments\Tables;

use App\Filament\Support\AdminNotify;
use App\Filament\Support\DateRangeFilter;
use App\Filament\Support\ExportCsv;
use App\Jobs\SendPushJob;
use App\Models\Payment;
use Filament\Actions\Action;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\Textarea;
use Filament\Support\Icons\Heroicon;
use Illuminate\Support\Facades\Cache;
use Filament\Tables\Columns\Summarizers\Sum;
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
                    ->sortable()
                    // Scope the footer to COLLECTED (completed) payments — the
                    // table has no default status filter, so an unscoped Sum
                    // added pending/failed/expired/cancelled (never transacted)
                    // and refunded (paid back) amounts into the "Total", ~3x
                    // overstating collected money on the default reconciliation
                    // view. Mirrors the BookingsTable GMV fix and the
                    // PaymentListStats "Collected" definition (status=completed).
                    ->summarize(
                        Sum::make('collected')
                            ->money('PHP')
                            ->label('Total collected')
                            ->query(fn (\Illuminate\Database\Query\Builder $query) => $query->where('status', 'completed'))
                    ),
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
                DateRangeFilter::make('created_at', 'Date'),
            ])
            ->headerActions([
                ExportCsv::make('payments', [
                    'Booking' => fn (Payment $r): ?string => $r->booking?->booking_number,
                    'Customer' => fn (Payment $r): ?string => $r->customer?->full_name,
                    'Amount (PHP)' => fn (Payment $r) => $r->amount,
                    'Method' => fn (Payment $r): ?string => $r->method,
                    'Status' => fn (Payment $r): ?string => $r->status,
                    'Gateway Tx ID' => fn (Payment $r): ?string => $r->gateway_tx_id,
                    'Paid at' => fn (Payment $r) => $r->paid_at,
                    'Refund amount (PHP)' => fn (Payment $r) => $r->refund_amount,
                    'Created' => fn (Payment $r) => $r->created_at,
                ]),
            ])
            ->toolbarActions([
                ExportCsv::bulk('payments', [
                    'Booking' => fn (Payment $r): ?string => $r->booking?->booking_number,
                    'Customer' => fn (Payment $r): ?string => $r->customer?->full_name,
                    'Amount (PHP)' => fn (Payment $r) => $r->amount,
                    'Method' => fn (Payment $r): ?string => $r->method,
                    'Status' => fn (Payment $r): ?string => $r->status,
                    'Created' => fn (Payment $r) => $r->created_at,
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
                                $refundedTo = 'gateway';
                            } else {
                                $service->refundToWallet($record->id, $data['reason']);
                                $refundedTo = 'wallet';
                            }

                            // Tell the CUSTOMER. Money arriving (or leaving, back
                            // to a card) with no explanation is a guaranteed
                            // support ticket — and the dispute-driven refund path
                            // already pushes, so silence here was an
                            // inconsistency, not a policy. Placed on the ACTION
                            // (not in PaymentService) so the cancel/dispute paths,
                            // which notify via their own events, can't
                            // double-push. Cache flag keeps a re-run silent even
                            // though refundToWallet/refundPayment already reject a
                            // second refund. The admin's raw reason is a gateway
                            // code (REQUESTED_BY_CUSTOMER) so it rides in the data
                            // payload, not the user-facing body. (A2)
                            self::notifyCustomerOfRefund($record, $refundedTo);

                            AdminNotify::success(
                                'Refund processed',
                                $record,
                                context: [
                                    'Amount' => '₱'.number_format((float) $record->amount, 2),
                                    'Method' => ucfirst((string) $record->method),
                                    'Customer' => $record->customer?->full_name,
                                ],
                                audit: 'payment.refunded',
                                properties: ['method' => $record->method, 'amount' => 'full', 'reason' => $data['reason']],
                            );
                        } catch (\Throwable $e) {
                            AdminNotify::error('Refund failed', $e, $record, context: [
                                'Amount' => '₱'.number_format((float) $record->amount, 2),
                            ]);
                        }
                    }),
            ]);
    }

    /**
     * Queue one customer-facing notice for an admin-executed refund. Queued
     * (SendPushJob) so the admin's request never blocks on Expo/FCM, and guarded
     * by a per-payment cache flag so no retry/double-tap can push twice.
     * Notification only — it runs after the money operation has committed.
     */
    private static function notifyCustomerOfRefund(Payment $payment, string $refundedTo): void
    {
        if (blank($payment->customer_id)) {
            return;
        }

        if (! Cache::add("payment-refund-notified:{$payment->id}", true, 86400)) {
            return;
        }

        $amount = '₱'.number_format((float) $payment->amount, 2);
        $number = $payment->booking?->booking_number;
        $where = $refundedTo === 'gateway'
            ? 'back to your original card (it can take a few banking days to appear)'
            : 'to your ErrandGuy wallet';

        SendPushJob::dispatch(
            $payment->customer_id,
            'Refund issued',
            $number
                ? "{$amount} for errand #{$number} was refunded {$where}."
                : "{$amount} was refunded {$where}.",
            [
                'type' => 'payment',
                'payment_id' => $payment->id,
                'booking_id' => $payment->booking_id,
                'status' => 'refunded',
                'refund_amount' => round((float) $payment->amount, 2),
                'refunded_to' => $refundedTo,
                // The admin's `reason` is deliberately NOT forwarded. It looks
                // like a gateway code only because REQUESTED_BY_CUSTOMER is the
                // field's default — it is a required 500-char free-text box an
                // admin can overwrite with internal notes, and nothing warns
                // them it would reach the customer. The reason is already
                // captured on the refund record and the 'payment.refunded'
                // audit entry, which is where internal context belongs.
            ],
        );
    }
}
