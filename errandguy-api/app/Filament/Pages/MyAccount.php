<?php

namespace App\Filament\Pages;

use App\Filament\Support\AdminNotify;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Forms\Components\TextInput;
use Filament\Pages\Page;
use Filament\Support\Icons\Heroicon;
use Illuminate\Support\Facades\Hash;

/**
 * Self-service account page so an admin can update their own name/email and
 * change their password IN-PANEL — no redeploy / make-admin needed. Kept
 * separate from Filament's built-in EditProfile because AdminUser uses custom
 * columns (full_name / password_hash) that EditProfile doesn't map.
 */
class MyAccount extends Page
{
    protected string $view = 'filament.pages.my-account';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedUserCircle;

    protected static ?int $navigationSort = 99;

    protected static ?string $title = 'My account';

    public static function canAccess(): bool
    {
        return auth('admin')->check();
    }

    /** @return array{full_name:?string,email:?string,role:?string} */
    public function getAccount(): array
    {
        $u = auth('admin')->user();

        return [
            'full_name' => $u?->full_name,
            'email' => $u?->email,
            'role' => $u?->role,
        ];
    }

    protected function getHeaderActions(): array
    {
        return [
            Action::make('editProfile')
                ->label('Edit profile')
                ->icon(Heroicon::OutlinedPencilSquare)
                ->fillForm(fn (): array => [
                    'full_name' => auth('admin')->user()?->full_name,
                    'email' => auth('admin')->user()?->email,
                ])
                ->schema([
                    TextInput::make('full_name')->label('Full name')->required()->maxLength(100),
                    TextInput::make('email')->email()->required()->maxLength(255),
                ])
                ->action(function (array $data): void {
                    $admin = auth('admin')->user();
                    $admin->update(['full_name' => $data['full_name'], 'email' => $data['email']]);
                    AdminNotify::success('Your profile has been updated.', audit: 'account.profile_updated');
                }),

            Action::make('changePassword')
                ->label('Change password')
                ->icon(Heroicon::OutlinedKey)
                ->schema([
                    TextInput::make('password')
                        ->password()
                        ->revealable()
                        ->required()
                        ->minLength(8)
                        ->confirmed()
                        ->label('New password'),
                    TextInput::make('password_confirmation')
                        ->password()
                        ->revealable()
                        ->required()
                        ->label('Confirm new password'),
                ])
                ->action(function (array $data): void {
                    $admin = auth('admin')->user();
                    $admin->update(['password_hash' => Hash::make($data['password'])]);
                    AdminNotify::success('Your password has been changed.', audit: 'account.password_changed');
                }),
        ];
    }
}
