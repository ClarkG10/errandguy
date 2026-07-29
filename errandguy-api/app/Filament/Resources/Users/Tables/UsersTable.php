<?php

namespace App\Filament\Resources\Users\Tables;

use App\Filament\Support\DateRangeFilter;
use App\Filament\Support\ExportCsv;
use App\Models\AdminUser;
use App\Models\User;
use App\Support\AdminActivity;
use Filament\Actions\Action;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\Textarea;
use Filament\Notifications\Notification;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\ImageColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;

class UsersTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                ImageColumn::make('avatar_url')->label('')->circular(),
                TextColumn::make('full_name')->searchable()->sortable(),
                TextColumn::make('phone')->searchable(),
                TextColumn::make('email')->searchable()->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('role')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'runner' => 'info',
                        'customer' => 'gray',
                        default => 'gray',
                    }),
                TextColumn::make('status')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'active' => 'success',
                        'suspended' => 'danger',
                        default => 'gray',
                    }),
                TextColumn::make('wallet_balance')->money('PHP')->sortable(),
                TextColumn::make('avg_rating')->label('Rating')->numeric(2)->sortable(),
                IconColumn::make('email_verified')->boolean()->toggleable(isToggledHiddenByDefault: true),
                IconColumn::make('phone_verified')->boolean()->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('created_at')->dateTime()->since()
                    ->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                SelectFilter::make('role')->options([
                    'customer' => 'Customer',
                    'runner' => 'Runner',
                ]),
                SelectFilter::make('status')->options([
                    'active' => 'Active',
                    'suspended' => 'Suspended',
                ]),
                TernaryFilter::make('email_verified'),
                DateRangeFilter::make('created_at', 'Joined'),
            ])
            ->headerActions([
                ExportCsv::make('users', [
                    'Name' => fn (User $r): ?string => $r->full_name,
                    'Phone' => fn (User $r): ?string => $r->phone,
                    'Email' => fn (User $r): ?string => $r->email,
                    'Role' => fn (User $r): ?string => $r->role,
                    'Status' => fn (User $r): ?string => $r->status,
                    'Wallet balance (PHP)' => fn (User $r) => $r->wallet_balance,
                    'Avg rating' => fn (User $r) => $r->avg_rating,
                    'Joined' => fn (User $r) => $r->created_at,
                ]),
            ])
            ->recordActions([
                ViewAction::make(),

                Action::make('suspend')
                    ->label('Suspend')
                    ->icon(Heroicon::OutlinedShieldExclamation)
                    ->color('danger')
                    ->schema([
                        Textarea::make('reason')->required()->maxLength(500),
                    ])
                    ->visible(fn ($record): bool => $record->status !== 'suspended'
                        && (auth('admin')->user()?->hasAnyRole(
                            AdminUser::ROLE_SUPER_ADMIN,
                            AdminUser::ROLE_ADMIN,
                            AdminUser::ROLE_OPS,
                        ) ?? false))
                    ->action(function (array $data, $record): void {
                        $record->update([
                            'status' => 'suspended',
                            'suspended_reason' => $data['reason'],
                            'suspended_at' => now(),
                        ]);
                        $record->tokens()->delete();

                        AdminActivity::log('user.suspended', $record, ['reason' => $data['reason']]);

                        Notification::make()->title('User suspended')->success()->send();
                    }),

                Action::make('unsuspend')
                    ->label('Unsuspend')
                    ->icon(Heroicon::OutlinedShieldCheck)
                    ->color('success')
                    ->requiresConfirmation()
                    ->visible(fn ($record): bool => $record->status === 'suspended'
                        && (auth('admin')->user()?->hasAnyRole(
                            AdminUser::ROLE_SUPER_ADMIN,
                            AdminUser::ROLE_ADMIN,
                            AdminUser::ROLE_OPS,
                        ) ?? false))
                    ->action(function ($record): void {
                        $record->update([
                            'status' => 'active',
                            'suspended_reason' => null,
                            'suspended_at' => null,
                        ]);

                        AdminActivity::log('user.unsuspended', $record);

                        Notification::make()->title('User reinstated')->success()->send();
                    }),
            ]);
    }
}
