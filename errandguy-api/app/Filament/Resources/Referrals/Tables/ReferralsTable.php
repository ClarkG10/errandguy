<?php

namespace App\Filament\Resources\Referrals\Tables;

use App\Filament\Support\ExportCsv;
use App\Models\Referral;
use App\Support\AdminActivity;
use Filament\Actions\Action;
use Filament\Actions\ViewAction;
use Filament\Notifications\Notification;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class ReferralsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('referrer.full_name')
                    ->label('Referrer')
                    ->searchable(),
                TextColumn::make('referee.full_name')
                    ->label('Referee')
                    ->searchable(),
                TextColumn::make('status')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'rewarded' => 'success',
                        'qualified' => 'info',
                        'pending' => 'warning',
                        default => 'gray',
                    }),
                TextColumn::make('reward_amount')
                    ->money('PHP'),
                TextColumn::make('qualified_at')
                    ->dateTime()
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('rewarded_at')
                    ->dateTime()
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('created_at')
                    ->since(),
            ])
            ->filters([
                SelectFilter::make('status')
                    ->options([
                        'pending' => 'Pending',
                        'qualified' => 'Qualified',
                        'rewarded' => 'Rewarded',
                    ]),
            ])
            ->headerActions([
                ExportCsv::make('referrals', [
                    'Referrer' => fn (Referral $r): ?string => $r->referrer?->full_name,
                    'Referee' => fn (Referral $r): ?string => $r->referee?->full_name,
                    'Status' => fn (Referral $r): ?string => $r->status,
                    'Reward (PHP)' => fn (Referral $r) => $r->reward_amount,
                    'Qualified' => fn (Referral $r) => $r->qualified_at,
                    'Rewarded' => fn (Referral $r) => $r->rewarded_at,
                    'Created' => fn (Referral $r) => $r->created_at,
                ]),
            ])
            ->recordActions([
                ViewAction::make(),
                Action::make('reward')
                    ->label('Reward')
                    ->icon(Heroicon::OutlinedGift)
                    ->color('success')
                    ->requiresConfirmation()
                    ->visible(fn ($record): bool => $record->status !== 'rewarded'
                        && (auth('admin')->user()?->canManageMoney() ?? false))
                    ->action(function ($record): void {
                        try {
                            app(\App\Services\ReferralService::class)->reward($record->referee_id);
                            AdminActivity::log('referral.rewarded', $record);
                            Notification::make()->title('Referral rewarded')->success()->send();
                        } catch (\Throwable $e) {
                            Notification::make()->title('Failed')->body($e->getMessage())->danger()->send();
                        }
                    }),
            ]);
    }
}
