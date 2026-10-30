<?php

namespace App\Filament\Resources\Staff\Pages;

use App\Exceptions\StaffAccountException;
use App\Filament\Resources\Staff\StaffResource;
use App\Filament\Support\AdminNotify;
use App\Models\AdminUser;
use App\Services\StaffAccountService;
use Filament\Actions\Action;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Resources\Pages\ListRecords;
use Filament\Support\Icons\Heroicon;
use Illuminate\Validation\Rule;

class ListStaff extends ListRecords
{
    protected static string $resource = StaffResource::class;

    protected function getHeaderActions(): array
    {
        return [
            Action::make('addStaff')
                ->label('Add staff member')
                ->icon(Heroicon::OutlinedUserPlus)
                ->visible(fn (): bool => StaffResource::canManageStaff())
                ->modalDescription('They get an email with a link to choose their password, and set up two-step sign-in the first time they sign in.')
                ->schema([
                    TextInput::make('full_name')->label('Full name')->required()->maxLength(100),
                    TextInput::make('email')
                        ->email()
                        ->required()
                        ->maxLength(255)
                        ->rule(Rule::unique('admin_users', 'email'))
                        ->validationMessages(['unique' => 'A staff account with this email already exists.']),
                    Select::make('role')
                        ->required()
                        ->options(AdminUser::ROLE_LABELS)
                        ->native(false),
                ])
                ->action(function (array $data): void {
                    $service = app(StaffAccountService::class);

                    try {
                        $staff = $service->invite($data['full_name'], $data['email'], $data['role']);
                    } catch (StaffAccountException $e) {
                        AdminNotify::error('Could not add staff member', $e);

                        return;
                    }

                    try {
                        $service->sendSetPasswordLink($staff, isInvite: true);
                    } catch (\Throwable $e) {
                        report($e);
                        AdminNotify::error(
                            'Staff member added, but the email didn’t send',
                            'Use “Send set-password email” on their row to try again.',
                            $staff,
                        );

                        return;
                    }

                    AdminNotify::success(
                        'Staff member added',
                        context: ['Email' => $staff->email, 'Role' => $staff->role],
                        note: 'A set-password email is on its way to them.',
                    );
                }),
        ];
    }
}
