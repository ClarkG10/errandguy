<?php

namespace App\Filament\Resources\DisputeTickets\Tables;

use App\Filament\Support\AdminNotify;
use App\Filament\Support\DateRangeFilter;
use App\Filament\Support\ExportCsv;
use App\Models\DisputeTicket;
use App\Models\Payment;
use App\Services\PaymentService;
use Filament\Actions\Action;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\Textarea;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class DisputeTicketsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('created_at')
                    ->dateTime()
                    ->since()
                    ->sortable(),
                TextColumn::make('reporter.full_name')
                    ->label('Reporter')
                    ->searchable(),
                TextColumn::make('category'),
                TextColumn::make('booking.booking_number')
                    ->label('Booking')
                    ->toggleable(),
                TextColumn::make('status')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'resolved' => 'success',
                        'open', 'reviewing' => 'warning',
                        'escalated' => 'danger',
                        default => 'gray',
                    }),
                TextColumn::make('resolved_at')
                    ->dateTime()
                    ->toggleable(),
            ])
            ->filters([
                SelectFilter::make('status')
                    ->options([
                        'open' => 'Open',
                        'reviewing' => 'Reviewing',
                        'resolved' => 'Resolved',
                        'escalated' => 'Escalated',
                    ]),
                DateRangeFilter::make('created_at', 'Created'),
            ])
            ->headerActions([
                ExportCsv::make('disputes', [
                    'Booking' => fn (DisputeTicket $r): ?string => $r->booking?->booking_number,
                    'Reporter' => fn (DisputeTicket $r): ?string => $r->reporter?->full_name,
                    'Category' => fn (DisputeTicket $r): ?string => $r->category,
                    'Status' => fn (DisputeTicket $r): ?string => $r->status,
                    'Created' => fn (DisputeTicket $r) => $r->created_at,
                    'Resolved' => fn (DisputeTicket $r) => $r->resolved_at,
                ]),
            ])
            ->toolbarActions([
                ExportCsv::bulk('disputes', [
                    'Booking' => fn (DisputeTicket $r): ?string => $r->booking?->booking_number,
                    'Reporter' => fn (DisputeTicket $r): ?string => $r->reporter?->full_name,
                    'Category' => fn (DisputeTicket $r): ?string => $r->category,
                    'Status' => fn (DisputeTicket $r): ?string => $r->status,
                    'Created' => fn (DisputeTicket $r) => $r->created_at,
                    'Resolved' => fn (DisputeTicket $r) => $r->resolved_at,
                ]),
            ])
            ->recordActions([
                ViewAction::make(),
                Action::make('resolve')
                    ->label('Resolve')
                    ->icon(Heroicon::OutlinedShieldCheck)
                    ->color('success')
                    ->visible(fn ($record): bool => ! in_array($record->status, ['resolved'], true)
                        && (auth('admin')->user()?->canHandleSupport() ?? false))
                    ->schema([
                        Textarea::make('resolution')
                            ->required()
                            // The reporter now SEES this text (truncated) in their
                            // resolution push — write it for them, not for the
                            // audit log. Mirrors the KYC rejection-reason pattern.
                            ->helperText('Shown to the reporter in their notification — write it for them.')
                            ->maxLength(1000),
                    ])
                    ->action(function (array $data, $record): void {
                        $record->update([
                            'status' => 'resolved',
                            'resolution' => $data['resolution'],
                            'resolved_by' => auth('admin')->id(),
                            'resolved_at' => now(),
                        ]);
                        // The old push said only "Your dispute has been resolved."
                        // — a dead end, since no customer/runner endpoint can read
                        // a dispute back. Carry the outcome IN the notification:
                        // truncated into the body, full text in the data payload.
                        \App\Jobs\SendPushJob::dispatch(
                            $record->reported_by,
                            'Dispute Resolved',
                            self::resolutionBody($data['resolution']),
                            self::resolutionData($record, $data['resolution']),
                        );
                        AdminNotify::success('Dispute resolved', $record, [
                            'Ticket' => $record->id,
                            'Booking' => $record->booking?->booking_number,
                        ], audit: 'dispute.resolved');
                    }),
                Action::make('resolveRefund')
                    ->label('Resolve + refund')
                    ->icon(Heroicon::OutlinedReceiptRefund)
                    ->color('warning')
                    // Money surface (issues a real refund): Super Admin + Finance
                    // only, and only while the ticket is still open.
                    ->visible(fn ($record): bool => ! in_array($record->status, ['resolved'], true)
                        && (auth('admin')->user()?->canManageMoney() ?? false))
                    ->requiresConfirmation()
                    ->modalDescription('Refunds the FULL booking payment to the customer’s wallet, then marks the dispute resolved. For a partial or goodwill amount, use “Adjust wallet” on the user instead.')
                    ->schema([
                        Textarea::make('resolution')
                            ->label('Resolution note')
                            ->required()
                            ->maxLength(1000),
                    ])
                    ->action(function (array $data, $record): void {
                        // The booking's settled charge. refundToWallet is
                        // idempotent and rejects cash (nothing was held) + any
                        // non-completed payment, so those surface as a clean
                        // error rather than a bad refund.
                        $payment = Payment::where('booking_id', $record->booking_id)
                            ->where('status', 'completed')
                            ->latest('created_at')
                            ->first();

                        if (! $payment) {
                            AdminNotify::error(
                                'Nothing to refund',
                                'This booking has no completed online payment. If it was cash it was settled directly with the runner — resolve without a refund, or credit the wallet manually via “Adjust wallet”.',
                                $record,
                            );

                            return;
                        }

                        try {
                            app(PaymentService::class)->refundToWallet(
                                $payment->id,
                                'Dispute resolution: '.$data['resolution'],
                            );

                            $record->update([
                                'status' => 'resolved',
                                'resolution' => $data['resolution'],
                                'resolved_by' => auth('admin')->id(),
                                'resolved_at' => now(),
                            ]);

                            // Notify the person who was actually refunded (the
                            // customer who paid) — not necessarily the reporter,
                            // who may be the runner.
                            \App\Jobs\SendPushJob::dispatch(
                                $payment->customer_id,
                                'Refund issued',
                                '₱'.number_format((float) $payment->amount, 2).' was refunded to your ErrandGuy wallet after your dispute was resolved.',
                                array_merge(
                                    // The resolution note is written FOR the
                                    // reporter ("write it for them", per the
                                    // field's helper text). Attach it only when
                                    // the refunded customer IS the reporter —
                                    // otherwise a note addressed to the runner
                                    // who complained would be delivered verbatim
                                    // to the customer they complained about.
                                    $record->reported_by === $payment->customer_id
                                        ? self::resolutionData($record, $data['resolution'])
                                        : ['dispute_id' => $record->id, 'booking_id' => $record->booking_id],
                                    [
                                        'type' => 'payment',
                                        'refund_amount' => round((float) $payment->amount, 2),
                                        'refunded_to' => 'wallet',
                                    ],
                                ),
                            );

                            // When the REPORTER is not the refunded customer (a
                            // runner reported it), they previously received
                            // nothing at all — their case just went quiet. Give
                            // them the same resolution notice the plain resolve
                            // action sends.
                            if ($record->reported_by && $record->reported_by !== $payment->customer_id) {
                                \App\Jobs\SendPushJob::dispatch(
                                    $record->reported_by,
                                    'Dispute Resolved',
                                    self::resolutionBody($data['resolution']),
                                    self::resolutionData($record, $data['resolution']),
                                );
                            }

                            AdminNotify::success('Dispute resolved + refunded', $record, [
                                'Ticket' => $record->id,
                                'Booking' => $record->booking?->booking_number,
                                'Refunded' => '₱'.number_format((float) $payment->amount, 2),
                            ], audit: 'dispute.resolved_refunded', properties: [
                                'payment_id' => $payment->id,
                                'amount' => (float) $payment->amount,
                                'resolution' => $data['resolution'],
                            ]);
                        } catch (\Throwable $e) {
                            // e.g. cash payment, already refunded — refundToWallet
                            // throws a clear RuntimeException we surface verbatim.
                            AdminNotify::error('Could not refund', $e, $record);
                        }
                    }),
                Action::make('escalate')
                    ->label('Escalate')
                    ->icon(Heroicon::OutlinedExclamationTriangle)
                    ->color('danger')
                    ->requiresConfirmation()
                    ->visible(fn ($record): bool => $record->status !== 'escalated'
                        && (auth('admin')->user()?->canHandleSupport() ?? false))
                    ->action(function ($record): void {
                        $record->update(['status' => 'escalated']);
                        // Escalation used to be silent to the reporter, so a case
                        // that was in fact still moving looked abandoned. Tell
                        // them it's alive. Fires only on a real transition (the
                        // action is hidden once already escalated).
                        if ($record->reported_by) {
                            \App\Jobs\SendPushJob::dispatch(
                                $record->reported_by,
                                'Dispute Escalated',
                                'Your report is being reviewed by a senior specialist. We’ll notify you as soon as it’s resolved.',
                                [
                                    'type' => 'system',
                                    'dispute_id' => $record->id,
                                    'booking_id' => $record->booking_id,
                                    'dispute_status' => 'escalated',
                                ],
                            );
                        }
                        AdminNotify::success('Dispute escalated', $record, [
                            'Ticket' => $record->id,
                            'Booking' => $record->booking?->booking_number,
                        ], audit: 'dispute.escalated', note: 'It has been flagged for senior review.');
                    }),
            ]);
    }

    /**
     * User-facing body for a dispute resolution: the admin's own words, capped so
     * a 1000-char note doesn't get silently clipped by the OS notification
     * shade. The FULL text travels in the data payload (see resolutionData).
     */
    private static function resolutionBody(string $resolution): string
    {
        $resolution = trim(preg_replace('/\s+/', ' ', $resolution) ?? '');

        if ($resolution === '') {
            return 'Your dispute has been resolved.';
        }

        return 'Your dispute has been resolved: '.\Illuminate\Support\Str::limit($resolution, 150);
    }

    /**
     * Data payload for a dispute-resolution notification. Additive only: the
     * full resolution text plus the ids the app needs to open the related
     * errand. `type: 'system'` matches how the dispute pushes are already
     * classified in the app's notification inbox.
     *
     * @return array<string, mixed>
     */
    private static function resolutionData(DisputeTicket $ticket, string $resolution): array
    {
        return [
            'type' => 'system',
            'dispute_id' => $ticket->id,
            'booking_id' => $ticket->booking_id,
            'dispute_status' => 'resolved',
            'resolution' => $resolution,
        ];
    }
}
