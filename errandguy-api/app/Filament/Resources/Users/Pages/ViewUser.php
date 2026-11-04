<?php

namespace App\Filament\Resources\Users\Pages;

use App\Filament\Resources\Users\UserResource;
use App\Filament\Support\AdminNotify;
use App\Models\AdminUser;
use App\Services\AccountErasureService;
use App\Services\StaffMoneyLimit;
use App\Services\WalletService;
use App\Support\PayoutDestination;
use Filament\Actions\Action;
use Filament\Forms\Components\Placeholder;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Resources\Pages\ViewRecord;
use Filament\Support\Icons\Heroicon;

class ViewUser extends ViewRecord
{
    protected static string $resource = UserResource::class;

    protected function getHeaderActions(): array
    {
        return [
            // Same actions and role gates as the list row.
            \App\Filament\Resources\Users\Tables\UsersTable::suspendAction(),
            \App\Filament\Resources\Users\Tables\UsersTable::unsuspendAction(),
            Action::make('adjustWallet')
                ->label('Adjust wallet')
                ->icon(Heroicon::OutlinedBanknotes)
                ->color('warning')
                // Money surface: Super Admin + Finance only (canManageMoney).
                ->visible(fn (): bool => auth('admin')->user()?->canManageMoney() ?? false)
                ->modalHeading('Adjust wallet balance')
                ->modalSubmitActionLabel('Apply adjustment')
                ->requiresConfirmation()
                ->modalDescription('This directly changes real, withdrawable wallet balance and notifies the user. It is audited.')
                ->schema([
                    Placeholder::make('current_balance')
                        ->label('Current balance')
                        ->content(fn (): string => '₱'.number_format((float) $this->getRecord()->wallet_balance, 2)),
                    Placeholder::make('daily_allowance')
                        ->label('You can still move today')
                        ->content(fn (): string => '₱'.number_format(StaffMoneyLimit::remainingToday(auth('admin')->user()), 2)
                            .' of your ₱'.number_format(StaffMoneyLimit::dailyCap(), 2).' daily limit (credits, debits and “Pay a runner” together).'),
                    Select::make('direction')
                        ->label('Direction')
                        ->options([
                            'credit' => 'Credit (add to wallet)',
                            'debit' => 'Debit (remove from wallet)',
                        ])
                        ->default('credit')
                        ->required()
                        ->native(false),
                    TextInput::make('amount')
                        ->label('Amount (₱)')
                        ->numeric()
                        ->prefix('₱')
                        ->minValue(0.01)
                        ->maxValue(WalletService::MAX_ADJUSTMENT)
                        ->required()
                        ->helperText('Capped at ₱'.number_format(WalletService::MAX_ADJUSTMENT, 2).' per adjustment.'),
                    Textarea::make('reason')
                        ->label('Reason (required — shown to the user + audited)')
                        ->required()
                        ->maxLength(255),
                ])
                ->action(function (array $data): void {
                    $user = $this->getRecord();
                    $signed = ($data['direction'] === 'debit' ? -1 : 1) * (float) $data['amount'];

                    try {
                        $tx = app(WalletService::class)->adjust(auth('admin')->user(), $user->id, $signed, (string) $data['reason']);
                        $user->refresh();

                        AdminNotify::success(
                            'Wallet adjusted',
                            $user,
                            context: [
                                'User' => $user->full_name ?: $user->email,
                                'Change' => ($signed > 0 ? '+' : '−').'₱'.number_format(abs($signed), 2),
                                'New balance' => '₱'.number_format((float) $user->wallet_balance, 2),
                            ],
                            audit: 'wallet.adjusted',
                            properties: [
                                'amount' => round($signed, 2),
                                'reason' => $data['reason'],
                                'new_balance' => (float) $user->wallet_balance,
                                'wallet_transaction_id' => $tx->id,
                            ],
                        );
                    } catch (\RuntimeException $e) {
                        // Expected money-rule rejections (overdraw / per-adjustment
                        // cap / staff daily limit / blank reason) — show the
                        // reason, don't 500.
                        AdminNotify::error('Could not adjust wallet', $e, $user);
                    } catch (\Throwable $e) {
                        AdminNotify::error('Could not adjust wallet', $e, $user);
                    }
                }),
            $this->eraseAction(),
        ];
    }

    /**
     * Erase an account for someone who asked without the app (by email, as
     * the public /delete-account page offers) — including a suspended account,
     * which can't sign in to do it. The same erasure as the app's own Delete
     * account (AccountErasureService), with the same money rules: an errand in
     * progress or cash debt refuses it, and a balance is sent out as a payout
     * to the account given here.
     */
    private function eraseAction(): Action
    {
        return Action::make('eraseAccount')
            ->label('Erase account')
            ->icon(Heroicon::OutlinedTrash)
            ->color('danger')
            ->visible(fn (): bool => ! $this->getRecord()->trashed()
                && (auth('admin')->user()?->hasAnyRole(AdminUser::ROLE_SUPER_ADMIN, AdminUser::ROLE_ADMIN) ?? false))
            ->requiresConfirmation()
            ->modalHeading('Erase this account')
            ->modalDescription(fn (): string => 'Only after checking the request really comes from '
                .($this->getRecord()->full_name ?: 'this person').'. Their name, contact details, documents, addresses, '
                .'contacts and messages are erased and they are signed out everywhere; errand and payment records stay, '
                .'without their identity. This can’t be undone.'
                .((float) $this->getRecord()->wallet_balance > 0
                    ? ' Their wallet has ₱'.number_format((float) $this->getRecord()->wallet_balance, 2)
                        .': it is sent as a payout to the account below (leave it blank to use a runner’s saved payout details).'
                    : ''))
            ->modalSubmitActionLabel('Erase account')
            ->schema([
                Textarea::make('reason')
                    ->label('How they asked (for the audit log)')
                    ->required()
                    ->maxLength(500)
                    ->helperText('For example: email from the address on the account, 4 Nov.'),
                Select::make('channel')
                    ->label('Send the balance to')
                    ->options(fn (): array => $this->getRecord()->runnerProfile
                        ? ['gcash' => 'GCash', 'maya' => 'Maya', 'bank' => 'Bank account']
                        : ['gcash' => 'GCash', 'maya' => 'Maya'])
                    ->live()
                    ->visible(fn (): bool => (float) $this->getRecord()->wallet_balance > 0),
                TextInput::make('account_number')
                    ->label('Account or mobile number')
                    ->visible(fn (): bool => (float) $this->getRecord()->wallet_balance > 0),
                TextInput::make('account_name')
                    ->label('Name on the account')
                    ->visible(fn (): bool => (float) $this->getRecord()->wallet_balance > 0),
                TextInput::make('bank_name')
                    ->visible(fn (\Filament\Schemas\Components\Utilities\Get $get): bool => $get('channel') === 'bank'),
            ])
            ->action(function (array $data): void {
                $user = $this->getRecord();
                $hasProfile = $user->runnerProfile !== null;

                $destination = null;
                if (filled($data['channel'] ?? null)) {
                    $validator = \Illuminate\Support\Facades\Validator::make(
                        $data,
                        PayoutDestination::rules($data['channel'], allowBank: $hasProfile, required: true),
                        PayoutDestination::messages(allowBank: $hasProfile),
                    );
                    if ($validator->fails()) {
                        AdminNotify::error('Check the payout account', $validator->errors()->first(), $user);

                        return;
                    }
                    $destination = PayoutDestination::fromInput($validator->validated());
                }

                // Where an erased account's money goes is the same decision as
                // any payout's: their saved payout account, or — named in their
                // request — another one, which only a super admin may approve
                // (and the other money staff are told). Otherwise erasing would
                // be a way round the payout rule.
                $saved = $user->runnerProfile?->payoutDestination($user->full_name);
                $balance = round((float) $user->wallet_balance, 2);
                $chosen = $balance > 0 && $destination !== null
                    && \App\Filament\Pages\Payouts::destinationChanged($saved, $destination['channel_code'] ?? null, $destination['account_number'] ?? null);
                if ($chosen && ! (auth('admin')->user()?->isSuperAdmin() ?? false)) {
                    AdminNotify::error(
                        'A super admin has to approve this account',
                        ($saved ? 'Their saved payout account is '.PayoutDestination::label($saved).'. Leave the account blank to use it.' : 'They have no saved payout account.')
                            .' Only a super admin can send the balance to an account given in their request. Nothing was erased.',
                        $user,
                    );

                    return;
                }

                $outcome = app(AccountErasureService::class)->erase($user, $destination, auth('admin')->user(), $data['reason']);

                match ($outcome['status']) {
                    'active_errand' => AdminNotify::error('Not erased', 'They have an errand in progress. Finish, cancel or reassign it first.', $user),
                    'debt' => AdminNotify::error('Not erased', 'They owe ₱'.number_format(abs($outcome['balance']), 2)
                        .' from cash errands. It has to be settled first (an adjustment, once paid).', $user),
                    'needs_destination' => AdminNotify::error('Not erased', 'Their wallet has ₱'.number_format($outcome['balance'], 2)
                        .' and there is no saved payout account. Say where to send it.', $user),
                    'already_erased' => AdminNotify::warning('Already erased', 'This account was deleted a moment ago (they did it in the app).'),
                    default => null,
                };

                if ($outcome['status'] !== 'erased') {
                    return;
                }

                $payout = $outcome['payout'] ?? null;
                if ($chosen && $payout) {
                    $staff = auth('admin')->user();
                    \App\Models\AdminAlert::raise(
                        \App\Services\StaffMoneyLimit::ALERT_DESTINATION,
                        'warning',
                        'Erased account paid to an account given by request',
                        ($staff?->full_name ?? 'A staff member').' erased an account and queued its ₱'.number_format(abs((float) $payout->amount), 2)
                            .' to '.PayoutDestination::label($payout->payout_destination).', not a saved payout account. Reason: '.$data['reason'],
                        $payout->id,
                    );
                }
                AdminNotify::warning(
                    'Account erased',
                    $payout
                        ? '₱'.number_format(abs((float) $payout->amount), 2).' is queued on the Payouts page for '
                            .PayoutDestination::label($payout->payout_destination).'. Reply to their request once it is sent.'
                        : 'Reply to their request to confirm it is done.',
                );

                $this->redirect(UserResource::getUrl('index'));
            });
    }
}
