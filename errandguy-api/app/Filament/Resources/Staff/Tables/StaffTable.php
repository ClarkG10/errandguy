<?php

namespace App\Filament\Resources\Staff\Tables;

use App\Exceptions\StaffAccountException;
use App\Filament\Resources\Staff\StaffResource;
use App\Filament\Support\AdminNotify;
use App\Models\AdminUser;
use App\Services\StaffAccountService;
use App\Support\StaffSignIn;
use Closure;
use Filament\Actions\Action;
use Filament\Actions\ActionGroup;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;

class StaffTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('full_name')
            ->columns([
                TextColumn::make('full_name')
                    ->label('Name')
                    ->searchable()
                    ->sortable()
                    ->description(fn (AdminUser $record): string => $record->email),
                TextColumn::make('email')->searchable()->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('role')
                    ->badge()
                    ->color(fn (string $state): string => $state === AdminUser::ROLE_SUPER_ADMIN ? 'danger' : 'gray')
                    ->sortable(),
                TextColumn::make('status')
                    ->state(fn (AdminUser $record): string => match (true) {
                        ! $record->is_active => 'Disabled',
                        StaffSignIn::lockedSeconds(StaffSignIn::normalizeEmail($record->email)) > 0 => 'Locked out',
                        default => 'Active',
                    })
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'Active' => 'success',
                        'Locked out' => 'warning',
                        default => 'danger',
                    }),
                TextColumn::make('two_step')
                    ->label('Two-step sign-in')
                    ->state(fn (AdminUser $record): string => $record->twoStepMethod() ?? 'Not set up')
                    ->badge()
                    ->color(fn (string $state): string => $state === 'Not set up' ? 'warning' : 'success'),
                TextColumn::make('last_login_at')->label('Last sign-in')->since()->dateTimeTooltip()->placeholder('Never')->sortable(),
                TextColumn::make('created_at')->label('Added')->date()->sortable()->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                TernaryFilter::make('is_active')->label('Active'),
            ])
            ->recordActions([
                ActionGroup::make([
                    Action::make('changeRole')
                        ->label('Change role')
                        ->icon(Heroicon::OutlinedArrowsRightLeft)
                        ->visible(fn (AdminUser $record): bool => self::canActOn($record))
                        ->fillForm(fn (AdminUser $record): array => ['role' => $record->role])
                        ->schema([
                            Select::make('role')->required()->options(AdminUser::ROLE_LABELS)->native(false),
                        ])
                        ->action(self::run(
                            fn (StaffAccountService $service, AdminUser $by, AdminUser $record, array $data) => $service->changeRole($by, $record, $data['role']),
                            'Role changed',
                            'Could not change role',
                        )),

                    Action::make('sendSetPasswordLink')
                        ->label('Send set-password email')
                        ->icon(Heroicon::OutlinedEnvelope)
                        ->visible(fn (AdminUser $record): bool => StaffResource::canManageStaff() && $record->is_active)
                        ->requiresConfirmation()
                        ->modalDescription(fn (AdminUser $record): string => "Emails {$record->email} a link to choose a new password. Their current password keeps working until they do.")
                        ->action(self::run(
                            fn (StaffAccountService $service, AdminUser $by, AdminUser $record) => $service->sendSetPasswordLink($record),
                            'Set-password email sent',
                            'Could not send the email',
                        )),

                    Action::make('unlockSignIn')
                        ->label('Unlock sign-in')
                        ->icon(Heroicon::OutlinedLockOpen)
                        ->visible(fn (AdminUser $record): bool => StaffResource::canManageStaff()
                            && StaffSignIn::lockedSeconds(StaffSignIn::normalizeEmail($record->email)) > 0)
                        ->requiresConfirmation()
                        ->modalDescription('Lifts the 15-minute lock after too many failed sign-ins. Only do this if you know the failed attempts were theirs.')
                        ->action(self::run(
                            fn (StaffAccountService $service, AdminUser $by, AdminUser $record) => $service->unlockSignIn($record),
                            'Sign-in unlocked',
                            'Could not unlock sign-in',
                        )),

                    Action::make('resetTwoStep')
                        ->label('Reset two-step sign-in')
                        ->icon(Heroicon::OutlinedDevicePhoneMobile)
                        ->color('warning')
                        ->visible(fn (AdminUser $record): bool => self::canActOn($record) && $record->twoStepMethod() !== null)
                        ->requiresConfirmation()
                        ->modalDescription('For a lost phone or recovery codes. They set two-step sign-in up again right after their next password sign-in, and any “keep me signed in” browser is signed out.')
                        ->action(self::run(
                            fn (StaffAccountService $service, AdminUser $by, AdminUser $record) => $service->resetTwoStep($by, $record),
                            'Two-step sign-in reset',
                            'Could not reset two-step sign-in',
                        )),

                    Action::make('disable')
                        ->label('Disable account')
                        ->icon(Heroicon::OutlinedNoSymbol)
                        ->color('danger')
                        ->visible(fn (AdminUser $record): bool => self::canActOn($record) && $record->is_active)
                        ->requiresConfirmation()
                        ->modalDescription('They can’t sign in any more, and any open session ends on their next click.')
                        ->schema([
                            Textarea::make('reason')->label('Reason (kept in the audit log)')->required()->maxLength(500),
                        ])
                        ->action(self::run(
                            fn (StaffAccountService $service, AdminUser $by, AdminUser $record, array $data) => $service->disable($by, $record, $data['reason']),
                            'Account disabled',
                            'Could not disable account',
                        )),

                    Action::make('enable')
                        ->label('Enable account')
                        ->icon(Heroicon::OutlinedCheckCircle)
                        ->color('success')
                        ->visible(fn (AdminUser $record): bool => StaffResource::canManageStaff() && ! $record->is_active)
                        ->requiresConfirmation()
                        ->action(self::run(
                            fn (StaffAccountService $service, AdminUser $by, AdminUser $record) => $service->enable($record),
                            'Account enabled',
                            'Could not enable account',
                        )),
                ]),
            ]);
    }

    /** Super admin acting on someone other than themselves. */
    private static function canActOn(AdminUser $record): bool
    {
        return StaffResource::canManageStaff() && ! $record->is(auth('admin')->user());
    }

    /**
     * An action body that calls the service, then confirms or explains why not.
     *
     * @param  Closure(StaffAccountService, AdminUser, AdminUser, array): mixed  $call
     */
    private static function run(Closure $call, string $done, string $failed): Closure
    {
        return function (AdminUser $record, array $data = []) use ($call, $done, $failed): void {
            /** @var AdminUser $by */
            $by = auth('admin')->user();

            try {
                $call(app(StaffAccountService::class), $by, $record, $data);
            } catch (StaffAccountException $e) {
                AdminNotify::error($failed, $e, $record);

                return;
            } catch (\Throwable $e) {
                report($e);
                AdminNotify::error($failed, 'Something went wrong — see the logs.', $record);

                return;
            }

            AdminNotify::success($done, $record, context: ['Staff' => $record->full_name ?: $record->email]);
        };
    }
}
