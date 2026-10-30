<?php

namespace App\Filament\Pages;

use App\Filament\Support\AdminNotify;
use App\Models\AdminUser;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Auth\MultiFactor\Contracts\MultiFactorAuthenticationProvider;
use Filament\Facades\Filament;
use Filament\Forms\Components\TextInput;
use Filament\Pages\Page;
use Filament\Schemas\Components\Group;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Self-service account page: a staff member updates their own name/email,
 * changes their password and manages their two-step sign-in in-panel.
 * Changing anything asks for the current password first, so an unlocked,
 * unattended browser can't be used to take the account over. Kept separate
 * from Filament's built-in EditProfile because AdminUser uses custom columns
 * (full_name / password_hash) that EditProfile doesn't map.
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

    /** @return array{full_name:?string,email:?string,role:?string,two_step:?string} */
    public function getAccount(): array
    {
        $u = auth('admin')->user();

        return [
            'full_name' => $u?->full_name,
            'email' => $u?->email,
            'role' => $u?->role,
            'two_step' => $u instanceof AdminUser ? $u->twoStepMethod() : null,
        ];
    }

    /** Set up, switch or turn off a two-step sign-in method (Filament's own controls). */
    public function twoStepSignIn(Schema $schema): Schema
    {
        $user = Filament::auth()->user();

        return $schema->components([
            Section::make('Two-step sign-in')
                ->description('Every staff account needs at least one. An authenticator app works even when email is slow.')
                ->compact()
                ->divided()
                ->schema(collect(Filament::getMultiFactorAuthenticationProviders())
                    ->sortBy(fn (MultiFactorAuthenticationProvider $provider): int => $provider->isEnabled($user) ? 0 : 1)
                    ->map(fn (MultiFactorAuthenticationProvider $provider) => Group::make($provider->getManagementSchemaComponents())
                        ->statePath($provider->getId()))
                    ->values()
                    ->all()),
        ]);
    }

    private static function currentPasswordField(): TextInput
    {
        return TextInput::make('current_password')
            ->label('Current password')
            ->password()
            ->revealable()
            ->required()
            ->currentPassword(guard: 'admin')
            ->validationMessages(['current_password' => 'That isn’t your current password.']);
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
                    TextInput::make('email')
                        ->email()
                        ->required()
                        ->maxLength(255)
                        ->rule(fn () => Rule::unique('admin_users', 'email')->ignore(auth('admin')->id()))
                        ->validationMessages(['unique' => 'Another staff account already uses this email.']),
                    self::currentPasswordField(),
                ])
                ->action(function (array $data): void {
                    /** @var AdminUser $admin */
                    $admin = auth('admin')->user();
                    $before = ['full_name' => $admin->full_name, 'email' => $admin->email];

                    $admin->update([
                        'full_name' => trim($data['full_name']),
                        'email' => Str::lower(trim($data['email'])),
                    ]);

                    AdminNotify::success(
                        'Your profile has been updated.',
                        $admin,
                        audit: 'account.profile_updated',
                        properties: [
                            'old' => $before,
                            'new' => ['full_name' => $admin->full_name, 'email' => $admin->email],
                        ],
                    );
                }),

            Action::make('changePassword')
                ->label('Change password')
                ->icon(Heroicon::OutlinedKey)
                ->schema([
                    self::currentPasswordField(),
                    TextInput::make('password')
                        ->password()
                        ->revealable()
                        ->required()
                        ->minLength(8)
                        ->confirmed()
                        ->different('current_password')
                        ->label('New password'),
                    TextInput::make('password_confirmation')
                        ->password()
                        ->revealable()
                        ->required()
                        ->label('Confirm new password'),
                ])
                ->action(function (array $data): void {
                    /** @var AdminUser $admin */
                    $admin = auth('admin')->user();
                    $admin->update(['password_hash' => Hash::make($data['password'])]);

                    // Keep this browser signed in; every other session of this
                    // account ends on its next request (AuthenticateSession).
                    session()->put(
                        'password_hash_admin',
                        Auth::guard('admin')->hashPasswordForCookie($admin->getAuthPassword()),
                    );

                    AdminNotify::success('Your password has been changed.', $admin, audit: 'account.password_changed');
                }),
        ];
    }
}
