<?php

namespace App\Filament\Resources\DisputeTickets\Actions;

use App\Filament\Support\AdminNotify;
use App\Jobs\SendPushJob;
use App\Models\DisputeTicket;
use App\Models\Payment;
use App\Services\PaymentService;
use Filament\Actions\Action;
use Filament\Forms\Components\Textarea;
use Filament\Support\Icons\Heroicon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * The dispute decisions, built ONCE and mounted in both places an admin can
 * make them: the list row (triage) and the record page's header (where the
 * description and the evidence gallery actually are).
 *
 * Before this the buttons existed only on the table, so resolving a dispute
 * meant opening it to read the evidence, navigating BACK to the list,
 * re-finding the row — which may have moved or paginated away — and only then
 * clicking Resolve.
 *
 * The two contexts differ in exactly one mechanical way, and it is handled for
 * us: a table action is given the row's record, while a page header action
 * falls back to the page record via HasActions::getDefaultActionRecord(). Both
 * therefore inject the same `$record` closure argument, so every visibility
 * closure — and with it every role gate (canHandleSupport / canManageMoney) —
 * is shared by construction and cannot drift between the two surfaces.
 */
class DisputeTicketActions
{
    /**
     * Every decision, in triage order. Used verbatim by both
     * DisputeTicketsTable::configure() and ViewDisputeTicket::getHeaderActions().
     *
     * @return array<int, Action>
     */
    public static function all(): array
    {
        return [
            self::startReviewing(),
            self::resolve(),
            self::resolveRefund(),
            self::escalate(),
        ];
    }

    /**
     * Claim the case. 'reviewing' was offered as a tab, a badge colour and a
     * filter option while NOTHING in the codebase ever wrote it — a permanently
     * empty queue the operator re-scanned every session. This is the writer, so
     * a second admin can see the case is already being worked instead of
     * duplicating the investigation. Deliberately silent to the reporter: it is
     * an internal marker, not a decision, and the escalate action already covers
     * "a human is on this" for them.
     */
    public static function startReviewing(): Action
    {
        return Action::make('startReviewing')
            ->label('Start reviewing')
            ->icon(Heroicon::OutlinedMagnifyingGlass)
            ->color('info')
            ->requiresConfirmation()
            ->modalHeading('Take this dispute')
            ->modalDescription('Marks the dispute as being reviewed so the rest of the team can see it is claimed. The reporter is not notified.')
            ->visible(fn ($record): bool => $record?->status === 'open'
                && (auth('admin')->user()?->canHandleSupport() ?? false))
            ->action(function ($record): void {
                $record->update(['status' => 'reviewing']);

                AdminNotify::success('Marked as reviewing', $record, [
                    'Ticket' => $record->id,
                    'Booking' => $record->booking?->booking_number,
                ], audit: 'dispute.reviewing', note: 'The audit log records who claimed it.');
            });
    }

    public static function resolve(): Action
    {
        return Action::make('resolve')
            ->label('Resolve')
            ->icon(Heroicon::OutlinedShieldCheck)
            ->color('success')
            ->visible(fn ($record): bool => ! in_array($record?->status, ['resolved'], true)
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
                // Guard the transition under a row lock. `visible()` hides the
                // action once a ticket is resolved, but that is a RENDER-time
                // check: two admins on the ticket at the same time (or one
                // double-submitting) both saw it open, and without this both
                // writes land — overwriting the first resolver + resolution text
                // in the audit trail and pushing the reporter twice. This guard
                // used to live only in the now-deleted admin REST twin of this
                // action; consolidating on one implementation must not lose it.
                $transitioned = \Illuminate\Support\Facades\DB::transaction(
                    function () use ($data, $record): bool {
                        $locked = \App\Models\DisputeTicket::whereKey($record->getKey())
                            ->lockForUpdate()
                            ->first();

                        if (! $locked || $locked->status === 'resolved') {
                            return false;
                        }

                        $locked->update([
                            'status' => 'resolved',
                            'resolution' => $data['resolution'],
                            'resolved_by' => auth('admin')->id(),
                            'resolved_at' => now(),
                        ]);
                        $record->refresh();

                        return true;
                    },
                );

                // Only on a REAL transition, so a double-submit never
                // double-notifies the reporter or double-writes the audit log.
                if (! $transitioned) {
                    AdminNotify::success('Dispute already resolved', $record, [
                        'Ticket' => $record->id,
                    ]);

                    return;
                }

                // The old push said only "Your dispute has been resolved."
                // — a dead end, since no customer/runner endpoint can read
                // a dispute back. Carry the outcome IN the notification:
                // truncated into the body, full text in the data payload.
                SendPushJob::dispatch(
                    $record->reported_by,
                    'Dispute Resolved',
                    self::resolutionBody($data['resolution']),
                    self::resolutionData($record, $data['resolution']),
                );
                AdminNotify::success('Dispute resolved', $record, [
                    'Ticket' => $record->id,
                    'Booking' => $record->booking?->booking_number,
                ], audit: 'dispute.resolved');
            });
    }

    public static function resolveRefund(): Action
    {
        return Action::make('resolveRefund')
            ->label('Resolve + refund')
            ->icon(Heroicon::OutlinedReceiptRefund)
            ->color('warning')
            // Money surface (issues a real refund): Super Admin + Finance
            // only, and only while the ticket is still open.
            ->visible(fn ($record): bool => ! in_array($record?->status, ['resolved'], true)
                && (auth('admin')->user()?->canManageMoney() ?? false))
            // Tell the admin BEFORE they type a resolution note that there is
            // nothing to refund. Previously the Payment lookup happened inside
            // ->action(), i.e. after the modal was submitted, so a cash booking
            // failed with "Nothing to refund" and discarded the note. A disabled
            // Filament button keeps its tooltip (the `disabled` attribute is
            // dropped when a tooltip is set) and loses its wire:click, so the
            // reason is readable and the action unreachable.
            ->disabled(fn ($record): bool => self::refundBlocked($record))
            ->tooltip(fn ($record): ?string => self::refundBlocked($record)
                ? 'Nothing to refund: this booking has no completed online payment (cash is settled directly with the runner). Resolve without a refund, or credit the customer via “Adjust wallet”.'
                : null)
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
                // error rather than a bad refund. This lookup stays the
                // AUTHORITY — the disabled() gate above is only a hint
                // computed from the list query, and fails open.
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
                    SendPushJob::dispatch(
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
                        SendPushJob::dispatch(
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
            });
    }

    public static function escalate(): Action
    {
        return Action::make('escalate')
            ->label('Escalate')
            ->icon(Heroicon::OutlinedExclamationTriangle)
            ->color('danger')
            ->requiresConfirmation()
            ->visible(fn ($record): bool => $record?->status !== 'escalated'
                && $record?->status !== 'resolved'
                && (auth('admin')->user()?->canHandleSupport() ?? false))
            ->action(function ($record): void {
                // Same row-locked precondition as resolve(). `visible()` is a
                // render-time check, so an escalate submitted against a view
                // rendered before another admin resolved the ticket would
                // otherwise drag a RESOLVED dispute back to 'escalated' and push
                // the reporter about a case that is already closed. The two
                // invariants preserved here — escalate is idempotent, and a
                // resolved dispute cannot be escalated — were previously held
                // only by the now-deleted admin REST twin.
                $transitioned = \Illuminate\Support\Facades\DB::transaction(
                    function () use ($record): bool {
                        $locked = \App\Models\DisputeTicket::whereKey($record->getKey())
                            ->lockForUpdate()
                            ->first();

                        if (! $locked || in_array($locked->status, ['escalated', 'resolved'], true)) {
                            return false;
                        }

                        $locked->update(['status' => 'escalated']);
                        $record->refresh();

                        return true;
                    },
                );

                if (! $transitioned) {
                    AdminNotify::success('No change', $record, [
                        'Ticket' => $record->id,
                        'Status' => $record->fresh()?->status,
                    ]);

                    return;
                }

                // Escalation used to be silent to the reporter, so a case
                // that was in fact still moving looked abandoned. Tell
                // them it's alive. Fires only on a real transition (the
                // action is hidden once already escalated).
                if ($record->reported_by) {
                    SendPushJob::dispatch(
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
            });
    }

    /**
     * TRUE only when we POSITIVELY know there is nothing to refund.
     *
     * `is_refundable` is the withExists() column added by
     * DisputeTicketResource::getEloquentQuery(). FAIL SAFE is the whole point of
     * the `!== null` check: a record hydrated by some other query has no such
     * attribute, and a missing/unknown value must SHOW the action (letting
     * PaymentService reject it as before) rather than silently hide a legitimate
     * refund from the one admin who can issue it.
     */
    public static function refundBlocked(?Model $record): bool
    {
        $flag = $record?->getAttribute('is_refundable');

        return $flag !== null && ! (bool) $flag;
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

        return 'Your dispute has been resolved: '.Str::limit($resolution, 150);
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
