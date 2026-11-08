<?php

namespace App\Filament\Pages;

use App\Exceptions\PayoutStateException;
use App\Filament\Support\AdminNotify;
use App\Support\AdminActivity;
use App\Models\AdminAlert;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\PaymentService;
use App\Services\StaffMoneyLimit;
use App\Services\WalletService;
use App\Support\PayoutDestination;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Forms\Components\Hidden;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Pages\Page;
use Filament\Schemas\Components\Utilities\Set;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Concerns\InteractsWithTable;
use Filament\Tables\Contracts\HasTable;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Support\Str;

/**
 * Payout reconciliation + real disbursement.
 *
 * Payouts are WalletTransaction rows (type=payout): a runner's payout request,
 * a customer's withdrawal, a payout queued while deleting an account, or staff
 * "Pay a runner". Each carries the destination it was requested with.
 *
 * "Send via Xendit" disburses it via PaymentService::createPayout and marks it
 * SENT before the request leaves; it stays `pending` until the payout webhook
 * settles it (a failure re-credits the wallet). Once a payout is sent, only
 * Xendit can say what happened to it, so the manual "Mark completed" / "Mark
 * failed" overrides (for money moved outside the system) are offered only
 * for payouts that were never sent, and a sent one gets "Check with Xendit" —
 * a fresh lookup that settles it to whatever Xendit reports.
 */
class Payouts extends Page implements HasTable
{
    use InteractsWithTable;

    protected string $view = 'filament.pages.payouts';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedArrowUpTray;

    protected static string|\UnitEnum|null $navigationGroup = 'Money';

    protected static ?int $navigationSort = 15;

    protected static ?string $title = 'Payouts';

    public static function canAccess(): bool
    {
        return auth('admin')->user()?->canManageMoney() ?? false;
    }

    public static function getNavigationBadge(): ?string
    {
        $n = \App\Support\AdminCache::remember(
            \App\Support\AdminCache::BADGE_PAYOUTS,
            // Payouts staff can act on: pending and not yet handed to Xendit
            // (a sent one settles on its own when Xendit answers).
            fn () => WalletTransaction::where('type', 'payout')->where('status', 'pending')->whereNull('payout_sent_at')->count(),
        );

        return $n ? (string) $n : null;
    }

    public static function getNavigationBadgeColor(): ?string
    {
        return 'warning';
    }

    /**
     * Where staff should send this payout: the destination recorded on it, or
     * — for a payout requested before destinations were recorded — the
     * runner's saved payout method.
     *
     * @return array<string, ?string>|null
     */
    public static function destinationFor(WalletTransaction $record): ?array
    {
        try {
            $recorded = $record->payout_destination;
        } catch (\Throwable) {
            $recorded = null;
        }

        return $recorded ?: $record->user?->runnerProfile?->payoutDestination($record->user?->full_name);
    }

    /**
     * Whether staff changed where a payout goes: a different channel (when one
     * was recorded — a bank with no known code has none), or a different
     * account number. Formatting doesn't count: spaces and dashes are ignored,
     * and a mobile number matches on its last 10 digits (0917… = +63917…).
     */
    public static function destinationChanged(?array $recorded, ?string $channelCode, ?string $accountNumber): bool
    {
        // Nothing on record to compare with: whatever staff type is their
        // choice, not the person's, so it counts as a change.
        if (! $recorded) {
            return filled($accountNumber);
        }

        $recordedCode = $recorded['channel_code'] ?? null;
        if ($recordedCode !== null && $recordedCode !== $channelCode) {
            return true;
        }

        $isMobile = in_array($recorded['channel'] ?? null, ['gcash', 'maya', 'ewallet'], true);
        $key = function (?string $v) use ($isMobile): string {
            $digits = preg_replace('/\D/', '', (string) $v);

            return $isMobile ? substr($digits, -10) : $digits;
        };

        return $key($recorded['account_number'] ?? null) !== $key($accountNumber);
    }

    /** The reason field both payout forms show when the account is changed. */
    private static function changeReasonField(string $from): Textarea
    {
        return Textarea::make('change_reason')
            ->label('Why it goes to a different account')
            ->maxLength(500)
            ->helperText("Only if you changed the account above from {$from}. That needs a super admin and a reason, and the other money staff are alerted.");
    }

    /**
     * A payout goes to the account on record. Sending it anywhere else takes a
     * super admin and a written reason: one finance user could otherwise send
     * people's withdrawals to an account of their own — a redirect isn't money
     * they created, so it never counted toward their daily limit. Returns true
     * (and tells them) when it must stop here.
     */
    private static function refuseUnexplainedChange(?array $recorded, array $data, ?WalletTransaction $record = null): bool
    {
        if (! self::destinationChanged($recorded, $data['channel_code'] ?? null, $data['account_number'] ?? null)) {
            return false;
        }

        $onRecord = $recorded ? 'Their payout account is '.PayoutDestination::label($recorded).'.' : 'There is no payout account on record.';

        if (! (auth('admin')->user()?->isSuperAdmin() ?? false)) {
            AdminNotify::error(
                'A super admin has to approve this account',
                $onRecord.' Only a super admin can send a payout to a different account. Nothing was sent.',
                $record,
            );

            return true;
        }

        if (trim((string) ($data['change_reason'] ?? '')) === '') {
            AdminNotify::error(
                'Say why the account changed',
                $onRecord.' Put that account back, or add the reason for sending it elsewhere. Nothing was sent.',
                $record,
            );

            return true;
        }

        return false;
    }

    /**
     * Tell the other money staff when someone's money went (or was sent) to an
     * account they didn't give us. Raised after the send attempt, worded by
     * its outcome: a rejected send still leaves the new account recorded on
     * the payout, so the next attempt wouldn't look like a change.
     */
    private static function alertDestinationChange(?array $recorded, array $data, ?User $owner, float $amount, string $payoutId, ?string $sendError): void
    {
        if (! self::destinationChanged($recorded, $data['channel_code'] ?? null, $data['account_number'] ?? null)) {
            return;
        }

        $staff = auth('admin')->user();
        AdminAlert::raise(
            StaffMoneyLimit::ALERT_DESTINATION,
            'warning',
            $sendError === null ? 'Payout sent to a different account' : 'Payout to a different account tried',
            ($staff?->full_name ?? 'A staff member').($sendError === null ? ' sent ' : ' tried to send ')
                .($owner?->full_name ?? 'a user').'’s ₱'.number_format(abs($amount), 2).' payout to '.$data['account_number']
                .' instead of '.PayoutDestination::label($recorded).'. Reason: '.trim((string) ($data['change_reason'] ?? ''))
                .($sendError === null ? '' : ' (Xendit refused it: '.$sendError.')'),
            $payoutId,
        );
    }

    /**
     * The audit-log properties that say where the money went — masked
     * ("GCash •••• 4567"). The audit log is open to the admin role, which has
     * no money access; the full account stays on the payout itself, which
     * only money staff can open.
     */
    private static function destinationAudit(string $channelCode, string $accountNumber, string $accountName): array
    {
        $channel = PayoutDestination::channelForCode($channelCode) ?? 'bank';

        return [
            'channel' => $channel,
            'channel_code' => $channelCode,
            'to' => PayoutDestination::label(PayoutDestination::make($channel, $accountNumber, $accountName, channelCode: $channelCode)),
        ];
    }

    /** @return array<int, \Filament\Schemas\Components\Component> */
    private static function destinationFields(): array
    {
        return [
            Select::make('channel_code')->label('Channel')->required()->searchable()->options(PayoutDestination::CHANNEL_CODES),
            TextInput::make('account_number')->required()
                ->helperText('E-wallet: the mobile number. Bank: the account number.'),
            TextInput::make('account_holder_name')->label('Account name')->required(),
        ];
    }

    protected function getHeaderActions(): array
    {
        return [
            Action::make('payRunner')
                ->label('Pay a runner')
                ->icon(Heroicon::OutlinedBanknotes)
                ->modalHeading('Send a payout to a runner')
                ->modalDescription('This debits the runner’s wallet and disburses real funds via Xendit immediately.')
                ->schema([
                    Select::make('user_id')
                        ->label('Runner')
                        ->required()
                        ->searchable()
                        ->options(fn (): array => User::where('role', 'runner')
                            ->where('wallet_balance', '>', 0)
                            ->orderBy('full_name')
                            ->pluck('full_name', 'id')
                            ->all())
                        ->helperText('Only runners with a positive wallet balance are listed. Their saved payout method fills in below.')
                        ->live()
                        ->afterStateUpdated(function (?string $state, Set $set): void {
                            $runner = $state ? User::with('runnerProfile')->find($state) : null;
                            $destination = $runner?->runnerProfile?->payoutDestination($runner->full_name);
                            $set('channel_code', $destination['channel_code'] ?? null);
                            $set('account_number', $destination['account_number'] ?? null);
                            $set('account_holder_name', $destination['account_name'] ?? null);
                        }),
                    TextInput::make('amount')->numeric()->prefix('₱')->required()->minValue(1)
                        ->helperText(fn (): string => 'Counts toward your daily limit for money moved by hand: ₱'
                            .number_format(StaffMoneyLimit::remainingToday(auth('admin')->user()), 2).' left today.'),
                    ...self::destinationFields(),
                    self::changeReasonField('the runner’s saved payout account'),
                    // Per-modal idempotency token: generated when the form opens
                    // and resubmitted verbatim, so a double-click / re-fire of the
                    // SAME payout collapses to one debit + one disbursement, while
                    // a fresh "Pay a runner" always gets a new token (P0-8).
                    Hidden::make('idem')->default(fn (): string => (string) Str::uuid()),
                ])
                ->action(function (array $data): void {
                    // Same rule as "Send via Xendit": a different account than
                    // the runner saved needs a reason, checked before any debit.
                    $runner = User::with('runnerProfile')->find($data['user_id']);
                    $saved = $runner?->runnerProfile?->payoutDestination($runner->full_name);
                    if (self::refuseUnexplainedChange($saved, $data)) {
                        return;
                    }

                    $destination = PayoutDestination::make(
                        PayoutDestination::channelForCode($data['channel_code']) ?? 'bank',
                        $data['account_number'],
                        $data['account_holder_name'],
                        channelCode: $data['channel_code'],
                    );

                    $audit = [
                        'amount' => $data['amount'],
                        ...self::destinationAudit($data['channel_code'], $destination['account_number'], $data['account_holder_name']),
                    ];

                    // Debit + create the pending payout (money-safe). Nothing
                    // has moved if this fails.
                    try {
                        $tx = app(WalletService::class)->payout(auth('admin')->user(), $data['user_id'], (float) $data['amount'], $data['idem'] ?? null, $destination);
                    } catch (\Throwable $e) {
                        AdminNotify::error('Could not pay this runner', $e, context: [
                            'Amount' => '₱'.number_format((float) $data['amount'], 2),
                        ]);

                        return;
                    }

                    // Then disburse. A failure here is NOT "nothing happened":
                    // the wallet is already debited and the payout sits in the
                    // queue below. Saying "could not send" made staff try
                    // again, which debited the runner a second time.
                    try {
                        app(PaymentService::class)->createPayout(
                            $tx->id,
                            $data['channel_code'],
                            $destination['account_number'],
                            $data['account_holder_name'],
                        );
                    } catch (\Throwable $e) {
                        self::alertDestinationChange($saved, $data, $runner, (float) $tx->amount, $tx->id, $e->getMessage());
                        AdminActivity::log('payout.admin_initiated', $tx, [...$audit, 'sent' => false, 'error' => $e->getMessage()],
                            'Staff payout created; sending to Xendit failed');
                        $notSent = WalletTransaction::whereKey($tx->id)->value('payout_sent_at') === null;
                        AdminNotify::warning(
                            $notSent ? 'Payout created, but not sent' : 'Payout created — check with Xendit',
                            '₱'.number_format(abs((float) $tx->amount), 2).' was taken from '.($tx->user?->full_name ?? 'the runner').'’s wallet '
                                .'and the payout is in the list below. '.$e->getMessage().' Don’t pay again: '
                                .($notSent
                                    ? 'use “Send via Xendit” on that row once it’s fixed, or “Mark failed” to put the money back.'
                                    : 'follow up on that row.'),
                        );

                        return;
                    }

                    self::alertDestinationChange($saved, $data, $runner, (float) $tx->amount, $tx->id, null);
                    AdminNotify::success(
                        'Payout sent to Xendit',
                        $tx,
                        context: [
                            'Runner' => $tx->user?->full_name,
                            'Amount' => '₱'.number_format(abs((float) $tx->amount), 2),
                            'To' => PayoutDestination::label($destination),
                        ],
                        audit: 'payout.admin_initiated',
                        properties: [...$audit, 'sent' => true],
                        note: 'It will show as completed once Xendit confirms.',
                    );
                }),
        ];
    }

    public function table(Table $table): Table
    {
        return $table
            ->query(
                // runnerProfile: the destination fallback for payouts requested
                // before destinations were recorded on the payout.
                // withTrashed: an account deleted with money left is paid out
                // here, and its row showed no name at all.
                WalletTransaction::query()->where('type', 'payout')->with([
                    'user' => fn ($q) => $q->withTrashed()->select(['id', 'full_name', 'phone', 'role', 'deleted_at']),
                    'user.runnerProfile',
                ])
            )
            // Pending work first, and OLDEST pending at the top — the person
            // who has been waiting longest for their own money is the one to pay
            // next. A flat created_at DESC put them at the very bottom, so the
            // longest wait was served last (the same defect already fixed on the
            // KYC and support queues).
            //
            // Settled rows keep newest-first underneath, because for them this
            // page is a ledger being browsed, not a queue being worked.
            // Untyped on purpose: Filament injects this by PARAMETER NAME, and a
            // type hint here would have to match its internal Builder import.
            ->defaultSort(fn ($query) => $query
                ->orderByRaw("CASE WHEN status = 'pending' THEN 0 ELSE 1 END")
                ->orderByRaw("CASE WHEN status = 'pending' THEN created_at END ASC")
                ->orderByDesc('created_at'))
            ->columns([
                TextColumn::make('created_at')->label('Requested')->dateTime()->sortable(),
                TextColumn::make('user.full_name')->label('Account')->searchable()
                    ->description(fn (WalletTransaction $record): string => ucfirst((string) ($record->user?->role ?? ''))),
                TextColumn::make('user.phone')->toggleable(),
                TextColumn::make('amount')
                    ->label('Amount')
                    ->formatStateUsing(fn ($state): string => '₱' . number_format(abs((float) $state), 2))
                    ->sortable(),
                TextColumn::make('destination')
                    ->label('To')
                    ->state(fn (WalletTransaction $record): string => PayoutDestination::label(self::destinationFor($record))),
                // A sent payout is still `pending` in the ledger until Xendit
                // confirms; say so, because it is no longer staff's to decide.
                TextColumn::make('status')
                    ->badge()
                    ->formatStateUsing(fn (string $state, WalletTransaction $record): string => $state === 'pending' && $record->isSentToGateway()
                        ? 'Sent to Xendit'
                        : ucfirst($state))
                    ->color(fn (string $state, WalletTransaction $record): string => match (true) {
                        $state === 'pending' && $record->isSentToGateway() => 'info',
                        $state === 'completed' => 'success',
                        $state === 'pending' => 'warning',
                        $state === 'failed' => 'danger',
                        default => 'gray',
                    }),
                TextColumn::make('gateway_ref')
                    ->label('Xendit reference')
                    ->placeholder(fn (WalletTransaction $record): string => $record->payout_sent_at ? 'No answer yet' : '—')
                    ->searchable()
                    ->copyable()
                    ->toggleable(),
                TextColumn::make('processed_at')->dateTime()->toggleable(),
                TextColumn::make('failure_reason')->limit(40)->toggleable(),
            ])
            ->filters([
                SelectFilter::make('status')
                    ->options([
                        'pending' => 'Pending',
                        'completed' => 'Completed',
                        'failed' => 'Failed',
                        'reversed' => 'Reversed',
                    ])
                    ->default('pending'),
            ])
            // For reconciling against Xendit statements. Destinations are
            // masked (last four digits), like the wallet ledger export.
            ->headerActions([
                \App\Filament\Support\ExportCsv::make('payouts', [
                    'Requested' => fn (WalletTransaction $r) => $r->created_at,
                    'Account' => fn (WalletTransaction $r): ?string => $r->user?->full_name,
                    'Role' => fn (WalletTransaction $r): ?string => $r->user?->role,
                    'Amount (PHP)' => fn (WalletTransaction $r) => abs((float) $r->amount),
                    'Status' => fn (WalletTransaction $r): ?string => $r->status,
                    'To' => fn (WalletTransaction $r): string => PayoutDestination::label(self::destinationFor($r)),
                    'Sent to Xendit' => fn (WalletTransaction $r) => $r->payout_sent_at,
                    'Xendit reference' => fn (WalletTransaction $r): ?string => $r->gateway_ref,
                    'Processed' => fn (WalletTransaction $r) => $r->processed_at,
                    'Failure reason' => fn (WalletTransaction $r): ?string => $r->failure_reason,
                ]),
            ])
            ->recordActions([
                Action::make('sendViaXendit')
                    ->label('Send via Xendit')
                    ->icon(Heroicon::OutlinedPaperAirplane)
                    ->color('primary')
                    // Not offered without Xendit keys: it promised "Real money
                    // leaves now" and then could only fail. Paid by hand instead
                    // ("Mark completed").
                    ->visible(fn (WalletTransaction $record): bool => $record->status === 'pending'
                        && ! $record->isSentToGateway()
                        && filled(config('services.xendit.secret_key')))
                    ->modalHeading('Send this payout via Xendit')
                    ->modalDescription(fn (WalletTransaction $record): string => 'Disburses ₱'
                        .number_format(abs((float) $record->amount), 2).' to '
                        .($record->user?->full_name ?? 'this account').' via Xendit. Real money leaves now.')
                    ->fillForm(function (WalletTransaction $record): array {
                        $destination = self::destinationFor($record);

                        return [
                            'channel_code' => $destination['channel_code'] ?? null,
                            'account_number' => $destination['account_number'] ?? null,
                            'account_holder_name' => $destination['account_name'] ?? $record->user?->full_name,
                        ];
                    })
                    ->schema([
                        ...self::destinationFields(),
                        self::changeReasonField('the one it was requested to'),
                    ])
                    ->action(function (array $data, WalletTransaction $record): void {
                        // Sending someone's money to an account they didn't ask
                        // for is the one edit here that needs a reason and a
                        // second pair of eyes.
                        $recorded = self::destinationFor($record);
                        if (self::refuseUnexplainedChange($recorded, $data, $record)) {
                            return;
                        }
                        $changed = self::destinationChanged($recorded, $data['channel_code'], $data['account_number']);
                        $reason = trim((string) ($data['change_reason'] ?? ''));

                        try {
                            app(PaymentService::class)->createPayout(
                                $record->id,
                                $data['channel_code'],
                                $data['account_number'],
                                $data['account_holder_name'],
                            );
                            $sent = $record->fresh()->payout_destination;
                            AdminNotify::success(
                                'Payout sent to Xendit',
                                $record,
                                context: [
                                    'Account' => $record->user?->full_name,
                                    'Amount' => '₱'.number_format(abs((float) $record->amount), 2),
                                    'To' => PayoutDestination::label($sent),
                                ],
                                audit: 'payout.sent',
                                properties: [
                                    ...self::destinationAudit($data['channel_code'], (string) $sent['account_number'], $data['account_holder_name']),
                                    ...($changed ? ['destination_changed' => true, 'requested_to' => PayoutDestination::label($recorded), 'change_reason' => $reason] : []),
                                ],
                                note: 'It will show as completed once Xendit confirms.',
                            );
                            self::alertDestinationChange($recorded, $data, $record->user, (float) $record->amount, $record->id, null);
                        } catch (\Throwable $e) {
                            self::alertDestinationChange($recorded, $data, $record->user, (float) $record->amount, $record->id, $e->getMessage());
                            // The payout stays pending either way (refused, or
                            // unanswered and checked later), so "failed" was wrong;
                            // the message says which.
                            AdminNotify::error('Payout still pending', $e, $record, context: [
                                'Account' => $record->user?->full_name,
                            ]);
                        }
                    }),
                Action::make('checkWithXendit')
                    ->label('Check with Xendit')
                    ->icon(Heroicon::OutlinedArrowPath)
                    ->color('gray')
                    ->visible(fn (WalletTransaction $record): bool => $record->status === 'pending' && $record->isSentToGateway())
                    ->action(function (WalletTransaction $record): void {
                        ['transaction' => $tx, 'gateway_status' => $status] = app(WalletService::class)
                            ->refreshSentPayout($record, releaseIfUnknown: true);

                        $context = [
                            'Account' => $record->user?->full_name,
                            'Amount' => '₱'.number_format(abs((float) $record->amount), 2),
                        ];

                        match (true) {
                            $tx->status === 'completed' => AdminNotify::success('Xendit paid this payout', $tx, $context,
                                audit: 'payout.checked', properties: ['gateway_status' => $status],
                                note: 'It is now marked completed.'),
                            $tx->status === 'failed' => AdminNotify::success('Xendit says this payout failed', $tx, $context,
                                audit: 'payout.checked', properties: ['gateway_status' => $status],
                                note: 'The money is back in their wallet and they have been told.'),
                            $status === 'NOT_FOUND' && ! $tx->isSentToGateway() => AdminNotify::success('Xendit has no record of this payout', $tx, $context,
                                audit: 'payout.checked', properties: ['gateway_status' => $status],
                                note: 'It was never sent, so it is back to “not sent”: send it again, or mark it failed.'),
                            $status === 'NOT_FOUND' => AdminNotify::error('Xendit has no record of this payout yet',
                                'Its send went unanswered moments ago. Check again in a few minutes — don’t send it again yet.', $tx, $context),
                            $status === 'UNREACHABLE' => AdminNotify::error('Couldn’t reach Xendit', 'Nothing was changed. Try again in a moment.', $tx, $context),
                            default => AdminNotify::success('Still in progress at Xendit', $tx, $context,
                                note: "Xendit reports it as {$status}. It settles on its own once Xendit finishes."),
                        };
                    }),
                Action::make('complete')
                    ->label('Mark completed')
                    ->icon(Heroicon::OutlinedCheckCircle)
                    ->color('success')
                    ->requiresConfirmation()
                    ->modalDescription('Manual override: use only if you disbursed the funds outside the system.')
                    // A payout made by hand is only traceable by what staff
                    // write here: finance reconciles against this reference.
                    ->schema([
                        Textarea::make('paid_how')
                            ->label('How it was paid, and the reference')
                            ->required()
                            ->maxLength(500)
                            // Kept in the audit log: the reference finance
                            // reconciles against, not the person's full number.
                            ->helperText('For example: GCash to the number ending 4567, reference 1234567890.'),
                    ])
                    ->visible(fn (WalletTransaction $record): bool => $record->status === 'pending' && ! $record->isSentToGateway())
                    ->action(function (array $data, WalletTransaction $record): void {
                        try {
                            $tx = app(WalletService::class)->completePayout($record->id, byHand: true);
                            AdminNotify::success(
                                'Payout marked completed',
                                $tx,
                                context: [
                                    'Account' => $tx->user?->full_name,
                                    'Amount' => '₱'.number_format(abs((float) $tx->amount), 2),
                                ],
                                audit: 'payout.completed',
                                properties: ['paid_how' => $data['paid_how']],
                            );
                        } catch (PayoutStateException $e) {
                            AdminNotify::error('Could not complete payout', $e, $record);
                        }
                    }),
                Action::make('fail')
                    ->label('Mark failed')
                    ->icon(Heroicon::OutlinedXCircle)
                    ->color('danger')
                    ->requiresConfirmation()
                    ->modalDescription(fn (WalletTransaction $record): string => 'Marks this payout failed and re-credits ₱'
                        .number_format(abs((float) $record->amount), 2).' to '
                        .($record->user?->full_name ?? 'the account').'’s wallet.')
                    ->schema([
                        Textarea::make('reason')->label('Failure reason')->required()->maxLength(500),
                    ])
                    // Never for a payout handed to Xendit — failPayout refuses
                    // it too; only Xendit can fail a sent payout.
                    ->visible(fn (WalletTransaction $record): bool => $record->status === 'pending' && ! $record->isSentToGateway())
                    ->action(function (array $data, WalletTransaction $record): void {
                        try {
                            $wallet = app(WalletService::class);
                            $tx = $wallet->failPayout($record->id, $data['reason']);
                            // Tell them — the money just reappeared in their
                            // wallet and they were still expecting a transfer.
                            // Dispatched AFTER failPayout committed.
                            $wallet->notifyPayoutBounced($tx, $data['reason']);
                            AdminNotify::success(
                                'Payout failed — wallet re-credited',
                                $tx,
                                context: [
                                    'Account' => $tx->user?->full_name,
                                    'Amount' => '₱'.number_format(abs((float) $tx->amount), 2),
                                ],
                                audit: 'payout.failed',
                                properties: ['reason' => $data['reason']],
                                note: 'They have been told the money is back in their wallet, with your reason.',
                            );
                        } catch (PayoutStateException $e) {
                            AdminNotify::error('Could not mark payout failed', $e, $record);
                        }
                    }),
            ]);
    }
}
