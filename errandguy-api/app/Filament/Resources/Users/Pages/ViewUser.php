<?php

namespace App\Filament\Resources\Users\Pages;

use App\Filament\Resources\Users\UserResource;
use App\Filament\Support\AdminNotify;
use App\Services\WalletService;
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
                        $tx = app(WalletService::class)->adjust($user->id, $signed, (string) $data['reason']);
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
                        // Expected money-rule rejections (overdraw / cap / blank
                        // reason) — show the reason, don't 500.
                        AdminNotify::error('Could not adjust wallet', $e, $user);
                    } catch (\Throwable $e) {
                        AdminNotify::error('Could not adjust wallet', $e, $user);
                    }
                }),
        ];
    }
}
