<?php

namespace App\Filament\Pages;

use App\Exceptions\PayoutStateException;
use App\Filament\Support\AdminNotify;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\PaymentService;
use App\Services\WalletService;
use App\Support\AdminActivity;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Actions\BulkAction;
use Filament\Forms\Components\Hidden;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Pages\Page;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Concerns\InteractsWithTable;
use Filament\Tables\Contracts\HasTable;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Payout reconciliation + real disbursement.
 *
 * Payouts are WalletTransaction rows (type=payout). "Send via Xendit" actually
 * disburses to the runner's e-wallet/bank via PaymentService::createPayout;
 * the payout stays `pending` until the payout.succeeded / payout.failed webhook
 * settles it (failure re-credits the wallet). "Mark completed" / "Mark failed"
 * remain as manual overrides for out-of-band transfers. "Pay a runner" lets an
 * admin initiate a payout from a runner's balance without a runner request.
 */
class Payouts extends Page implements HasTable
{
    use InteractsWithTable;

    protected string $view = 'filament.pages.payouts';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedArrowUpTray;

    protected static string|\UnitEnum|null $navigationGroup = 'Money';

    protected static ?int $navigationSort = 15;

    protected static ?string $title = 'Payouts';

    /**
     * Common Xendit PH payout channel codes. Verify the exact set your account
     * supports via Xendit's dashboard / GET /payout_channels.
     */
    public const CHANNELS = [
        'PH_GCASH' => 'GCash',
        'PH_PAYMAYA' => 'Maya',
        'PH_GRABPAY' => 'GrabPay',
        'PH_SHOPEEPAY' => 'ShopeePay',
        'PH_BDO' => 'BDO',
        'PH_BPI' => 'BPI',
        'PH_UBP' => 'UnionBank',
        'PH_METROBANK' => 'Metrobank',
        'PH_LANDBANK' => 'Landbank',
        'PH_PNB' => 'PNB',
        'PH_RCBC' => 'RCBC',
        'PH_SECURITY' => 'Security Bank',
        'PH_CHINABANK' => 'China Bank',
        'PH_EASTWEST' => 'EastWest',
    ];

    public static function canAccess(): bool
    {
        return auth('admin')->user()?->canManageMoney() ?? false;
    }

    public static function getNavigationBadge(): ?string
    {
        $n = \App\Support\AdminCache::remember(
            \App\Support\AdminCache::BADGE_PAYOUTS,
            fn () => WalletTransaction::where('type', 'payout')->where('status', 'pending')->count(),
        );

        return $n ? (string) $n : null;
    }

    public static function getNavigationBadgeColor(): ?string
    {
        return 'warning';
    }

    /**
     * Tell the runner their payout bounced, and that the money is back.
     *
     * completePayout() pushes "Payout sent"; the failure/reversal paths only
     * re-credited the wallet and wrote failure_reason, so the runner kept
     * believing a transfer was in flight for 1–3 business days and then found
     * their balance mysteriously higher — the reason discoverable only by
     * scrolling the payout history card. Symmetric events deserve symmetric
     * notification: in-app row + device push via SendPushJob (which routes to
     * NotificationService::sendPush, exactly like the success push), and the
     * `payment` type + wallet_transaction_id payload mirror it too.
     *
     * MUST be called after the money transaction has committed (never inside
     * the lock), and is latched per payout in the cache so a re-run of the
     * admin action — or a later gateway callback for the same payout — can
     * never send the runner a second "your payout bounced".
     *
     * Public on purpose: the OTHER two paths that settle a payout into
     * failed/reversed (the Xendit payout.failed / payout.reversed webhook and
     * the AdminPayoutController::markFailed API) should route through this same
     * latch instead of growing their own copy. Handles both states.
     */
    public static function notifyRunnerOfBouncedPayout(WalletTransaction $tx, ?string $reason = null): void
    {
        // Cache::add is atomic: the first caller wins, everyone else no-ops.
        if (! Cache::add("payout_bounced_notified:{$tx->id}", true, now()->addDay())) {
            return;
        }

        $amount = number_format(abs((float) $tx->amount), 2);
        $reversed = $tx->status === 'reversed';
        $reason = Str::limit(trim((string) ($reason ?? $tx->failure_reason ?? '')), 140);

        $body = $reversed
            ? "Your ₱{$amount} payout was returned, so the money is back in your wallet."
            : "Your ₱{$amount} payout couldn’t be sent, so the money is back in your wallet.";

        if ($reason !== '') {
            $body .= " Reason: {$reason}.";
        }

        $body .= ' Check your payout details, then request it again.';

        \App\Jobs\SendPushJob::dispatch(
            $tx->user_id,
            $reversed ? 'Payout returned' : 'Payout couldn’t be sent',
            $body,
            [
                'type' => 'payment',
                'status' => $reversed ? 'reversed' : 'failed',
                'wallet_transaction_id' => $tx->id,
            ],
        );
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
                        ->helperText('Only runners with a positive wallet balance are listed.'),
                    TextInput::make('amount')->numeric()->prefix('₱')->required()->minValue(1),
                    Select::make('channel_code')->label('Channel')->required()->searchable()->options(self::CHANNELS),
                    TextInput::make('account_number')->required()
                        ->helperText('E-wallet: the mobile number. Bank: the account number.'),
                    TextInput::make('account_holder_name')->required(),
                    // Per-modal idempotency token: generated when the form opens
                    // and resubmitted verbatim, so a double-click / re-fire of the
                    // SAME payout collapses to one debit + one disbursement, while
                    // a fresh "Pay a runner" always gets a new token (P0-8).
                    Hidden::make('idem')->default(fn (): string => (string) Str::uuid()),
                ])
                ->action(function (array $data): void {
                    try {
                        // Debit + create the pending payout (money-safe), then disburse.
                        $tx = app(WalletService::class)->payout($data['user_id'], (float) $data['amount'], $data['idem'] ?? null);
                        app(PaymentService::class)->createPayout(
                            $tx->id,
                            $data['channel_code'],
                            $data['account_number'],
                            $data['account_holder_name'],
                        );
                        AdminNotify::success(
                            'Payout sent to Xendit',
                            $tx,
                            context: [
                                'Runner' => $tx->user?->full_name,
                                'Amount' => '₱'.number_format(abs((float) $tx->amount), 2),
                                'Channel' => $data['channel_code'],
                            ],
                            audit: 'payout.admin_initiated',
                            properties: ['channel' => $data['channel_code'], 'amount' => $data['amount']],
                            note: 'It will show as completed once Xendit confirms.',
                        );
                    } catch (\Throwable $e) {
                        AdminNotify::error('Could not send payout', $e, context: [
                            'Amount' => '₱'.number_format((float) $data['amount'], 2),
                        ]);
                    }
                }),
        ];
    }

    public function table(Table $table): Table
    {
        return $table
            ->query(
                WalletTransaction::query()->where('type', 'payout')->with('user:id,full_name,phone')
            )
            // Pending work first, and OLDEST pending at the top — the runner who
            // has been waiting longest for their own money is the one to pay
            // next. A flat created_at DESC put them at the very bottom, so the
            // longest wait was served last (the same defect already fixed on the
            // dispute queues).
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
                TextColumn::make('user.full_name')->label('Runner')->searchable(),
                TextColumn::make('user.phone')->toggleable(),
                TextColumn::make('amount')
                    ->label('Amount')
                    ->formatStateUsing(fn ($state): string => '₱' . number_format(abs((float) $state), 2))
                    ->sortable(),
                TextColumn::make('status')->badge()->color(fn (string $state): string => match ($state) {
                    'completed' => 'success',
                    'pending' => 'warning',
                    'failed' => 'danger',
                    'reversed' => 'gray',
                    default => 'gray',
                }),
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
            ->recordActions([
                Action::make('sendViaXendit')
                    ->label('Send via Xendit')
                    ->icon(Heroicon::OutlinedPaperAirplane)
                    ->color('primary')
                    ->visible(fn (WalletTransaction $record): bool => $record->status === 'pending')
                    ->modalHeading('Send this payout via Xendit')
                    ->modalDescription(fn (WalletTransaction $record): string => 'Disburses ₱'
                        .number_format(abs((float) $record->amount), 2).' to '
                        .($record->user?->full_name ?? 'the runner').' via Xendit. Real money leaves now.')
                    ->fillForm(function (WalletTransaction $record): array {
                        $profile = $record->user?->runnerProfile;

                        return [
                            'channel_code' => $profile?->payout_channel_code,
                            'account_number' => $profile?->ewallet_number ?: $profile?->bank_account_number,
                            'account_holder_name' => $record->user?->full_name,
                        ];
                    })
                    ->schema([
                        Select::make('channel_code')->label('Channel')->required()->searchable()->options(self::CHANNELS),
                        TextInput::make('account_number')->required()
                            ->helperText('E-wallet: the mobile number. Bank: the account number.'),
                        TextInput::make('account_holder_name')->required(),
                    ])
                    ->action(function (array $data, WalletTransaction $record): void {
                        try {
                            app(PaymentService::class)->createPayout(
                                $record->id,
                                $data['channel_code'],
                                $data['account_number'],
                                $data['account_holder_name'],
                            );
                            AdminNotify::success(
                                'Payout sent to Xendit',
                                $record,
                                context: [
                                    'Runner' => $record->user?->full_name,
                                    'Amount' => '₱'.number_format(abs((float) $record->amount), 2),
                                    'Channel' => $data['channel_code'],
                                ],
                                audit: 'payout.sent',
                                properties: ['channel' => $data['channel_code']],
                                note: 'It will show as completed once Xendit confirms.',
                            );
                        } catch (\Throwable $e) {
                            AdminNotify::error('Payout failed', $e, $record, context: [
                                'Runner' => $record->user?->full_name,
                            ]);
                        }
                    }),
                Action::make('complete')
                    ->label('Mark completed')
                    ->icon(Heroicon::OutlinedCheckCircle)
                    ->color('success')
                    ->requiresConfirmation()
                    ->modalDescription('Manual override: use only if you disbursed the funds outside the system.')
                    ->visible(fn (WalletTransaction $record): bool => $record->status === 'pending')
                    ->action(function (WalletTransaction $record): void {
                        try {
                            $tx = app(WalletService::class)->completePayout($record->id);
                            AdminNotify::success(
                                'Payout marked completed',
                                $tx,
                                context: [
                                    'Runner' => $tx->user?->full_name,
                                    'Amount' => '₱'.number_format(abs((float) $tx->amount), 2),
                                ],
                                audit: 'payout.completed',
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
                        .($record->user?->full_name ?? 'the runner').'’s wallet.')
                    ->schema([
                        Textarea::make('reason')->label('Failure reason')->required()->maxLength(500),
                    ])
                    ->visible(fn (WalletTransaction $record): bool => $record->status === 'pending')
                    ->action(function (array $data, WalletTransaction $record): void {
                        try {
                            $tx = app(WalletService::class)->failPayout($record->id, $data['reason']);
                            // Tell the runner — the money just reappeared in
                            // their wallet and they were still expecting a
                            // transfer. Dispatched AFTER failPayout committed.
                            self::notifyRunnerOfBouncedPayout($tx, $data['reason']);
                            AdminNotify::success(
                                'Payout failed — wallet re-credited',
                                $tx,
                                context: [
                                    'Runner' => $tx->user?->full_name,
                                    'Amount' => '₱'.number_format(abs((float) $tx->amount), 2),
                                ],
                                audit: 'payout.failed',
                                properties: ['reason' => $data['reason']],
                                note: 'The runner has been told the money is back in their wallet, with your reason.',
                            );
                        } catch (PayoutStateException $e) {
                            AdminNotify::error('Could not mark payout failed', $e, $record);
                        }
                    }),
            ])
            ->toolbarActions([
                // Batch-disburse pending payouts to each runner's SAVED payout
                // method. Idempotent per row (createPayout keys on po-{tx}), so a
                // re-run never double-sends. Rows that aren't pending or lack
                // saved details are skipped and counted — never silently dropped.
                BulkAction::make('sendSelectedViaXendit')
                    ->label('Send selected via Xendit')
                    ->icon(Heroicon::OutlinedPaperAirplane)
                    ->color('primary')
                    ->requiresConfirmation()
                    ->modalHeading('Send selected payouts via Xendit')
                    ->modalDescription('Disburses every selected PENDING payout to the runner’s SAVED payout method. Rows that aren’t pending, or have no saved payout details, are skipped. Real money leaves now.')
                    ->deselectRecordsAfterCompletion()
                    ->action(function (Collection $records): void {
                        $sent = 0;
                        $skipped = 0;
                        $failed = 0;

                        foreach ($records as $record) {
                            if ($record->status !== 'pending') {
                                $skipped++;
                                continue;
                            }

                            $profile = $record->user?->runnerProfile;
                            $channel = $profile?->payout_channel_code;
                            $account = $profile?->ewallet_number ?: $profile?->bank_account_number;
                            $holder = $record->user?->full_name;

                            if (blank($channel) || blank($account) || blank($holder)) {
                                $skipped++;
                                continue;
                            }

                            try {
                                app(PaymentService::class)->createPayout($record->id, $channel, $account, $holder);
                                AdminActivity::log('payout.sent', $record, ['channel' => $channel, 'via' => 'bulk']);
                                $sent++;
                            } catch (\Throwable $e) {
                                Log::warning('Bulk payout: a row failed to send', [
                                    'wallet_tx' => $record->id,
                                    'error' => $e->getMessage(),
                                ]);
                                $failed++;
                            }
                        }

                        $notes = [];
                        if ($skipped) {
                            $notes[] = "{$skipped} skipped (not pending, or no saved payout method).";
                        }
                        if ($failed) {
                            $notes[] = "{$failed} failed to send — see logs.";
                        }

                        AdminNotify::success(
                            $sent.' payout'.($sent === 1 ? '' : 's').' sent to Xendit',
                            note: $notes === []
                                ? 'They will show completed once Xendit confirms.'
                                : implode(' ', $notes),
                        );
                    }),
            ]);
    }
}
