<?php

namespace App\Filament\Pages;

use App\Exceptions\PayoutStateException;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use App\Support\AdminActivity;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Forms\Components\Textarea;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Concerns\InteractsWithTable;
use Filament\Tables\Contracts\HasTable;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

/**
 * Payout reconciliation. Payouts are WalletTransaction rows (type=payout);
 * complete/fail routes through WalletService so the fail path re-credits the
 * runner's wallet atomically (the same money-safe path the API uses).
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
            fn () => WalletTransaction::where('type', 'payout')->where('status', 'pending')->count(),
        );

        return $n ? (string) $n : null;
    }

    public static function getNavigationBadgeColor(): ?string
    {
        return 'warning';
    }

    public function table(Table $table): Table
    {
        return $table
            ->query(
                WalletTransaction::query()->where('type', 'payout')->with('user:id,full_name,phone')
            )
            ->defaultSort('created_at', 'desc')
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
                    ])
                    ->default('pending'),
            ])
            ->recordActions([
                Action::make('complete')
                    ->label('Mark completed')
                    ->icon(Heroicon::OutlinedCheckCircle)
                    ->color('success')
                    ->requiresConfirmation()
                    ->modalDescription('Confirm the funds have been disbursed to the runner.')
                    ->visible(fn (WalletTransaction $record): bool => $record->status === 'pending')
                    ->action(function (WalletTransaction $record): void {
                        try {
                            $tx = app(WalletService::class)->completePayout($record->id);
                            AdminActivity::log('payout.completed', $tx);
                            Notification::make()->title('Payout marked completed')->success()->send();
                        } catch (PayoutStateException $e) {
                            Notification::make()->title($e->getMessage())->danger()->send();
                        }
                    }),
                Action::make('fail')
                    ->label('Mark failed')
                    ->icon(Heroicon::OutlinedXCircle)
                    ->color('danger')
                    ->schema([
                        Textarea::make('reason')->label('Failure reason')->required()->maxLength(500),
                    ])
                    ->visible(fn (WalletTransaction $record): bool => $record->status === 'pending')
                    ->action(function (array $data, WalletTransaction $record): void {
                        try {
                            $tx = app(WalletService::class)->failPayout($record->id, $data['reason']);
                            AdminActivity::log('payout.failed', $tx, ['reason' => $data['reason']]);
                            Notification::make()->title('Payout failed — wallet re-credited')->success()->send();
                        } catch (PayoutStateException $e) {
                            Notification::make()->title($e->getMessage())->danger()->send();
                        }
                    }),
            ]);
    }
}
