<?php

namespace Tests\Feature\Admin;

use App\Filament\Pages\MyAccount;
use App\Models\AdminUser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Spatie\Activitylog\Models\Activity;
use Tests\TestCase;

/**
 * "My account": changing your name, email or password asks for your current
 * password, and a new email can't be one another staff account already uses.
 */
class MyAccountSecurityTest extends TestCase
{
    use RefreshDatabase;

    private AdminUser $me;

    protected function setUp(): void
    {
        parent::setUp();

        $this->me = AdminUser::create([
            'email' => 'me@errandguy.test', 'password_hash' => Hash::make('Current-pass-1'),
            'full_name' => 'Me', 'role' => 'support', 'is_active' => true,
        ]);
        AdminUser::create([
            'email' => 'taken@errandguy.test', 'password_hash' => Hash::make('Other-pass-1'),
            'full_name' => 'Someone Else', 'role' => 'ops', 'is_active' => true,
        ]);
        $this->actingAs($this->me, 'admin');
    }

    public function test_editing_the_profile_needs_the_current_password(): void
    {
        Livewire::test(MyAccount::class)
            ->callAction('editProfile', ['full_name' => 'Hijacked', 'email' => 'attacker@evil.test', 'current_password' => 'wrong'])
            ->assertHasActionErrors(['current_password']);

        $this->assertSame('me@errandguy.test', $this->me->fresh()->email);
        $this->assertSame('Me', $this->me->fresh()->full_name);

        Livewire::test(MyAccount::class)
            ->callAction('editProfile', ['full_name' => 'Me Renamed', 'email' => 'New@ErrandGuy.test', 'current_password' => 'Current-pass-1'])
            ->assertHasNoActionErrors();

        $this->assertSame('new@errandguy.test', $this->me->fresh()->email);
        $this->assertSame('Me Renamed', $this->me->fresh()->full_name);

        $entry = Activity::where('event', 'account.profile_updated')->sole();
        $this->assertSame('me@errandguy.test', $entry->properties['old']['email']);
        $this->assertSame('new@errandguy.test', $entry->properties['new']['email']);
    }

    public function test_the_new_email_must_be_unique_among_staff(): void
    {
        Livewire::test(MyAccount::class)
            ->callAction('editProfile', ['full_name' => 'Me', 'email' => 'taken@errandguy.test', 'current_password' => 'Current-pass-1'])
            ->assertHasActionErrors(['email' => 'unique']);

        $this->assertSame('me@errandguy.test', $this->me->fresh()->email);
    }

    public function test_changing_the_password_needs_the_current_one_and_keeps_this_session(): void
    {
        Livewire::test(MyAccount::class)
            ->callAction('changePassword', ['current_password' => 'wrong', 'password' => 'Brand-new-pass-2', 'password_confirmation' => 'Brand-new-pass-2'])
            ->assertHasActionErrors(['current_password']);

        $this->assertTrue(Hash::check('Current-pass-1', $this->me->fresh()->password_hash));

        Livewire::test(MyAccount::class)
            ->callAction('changePassword', ['current_password' => 'Current-pass-1', 'password' => 'Current-pass-1', 'password_confirmation' => 'Current-pass-1'])
            ->assertHasActionErrors(['password']);

        Livewire::test(MyAccount::class)
            ->callAction('changePassword', ['current_password' => 'Current-pass-1', 'password' => 'Brand-new-pass-2', 'password_confirmation' => 'Brand-new-pass-2'])
            ->assertHasNoActionErrors();

        $fresh = $this->me->fresh();
        $this->assertTrue(Hash::check('Brand-new-pass-2', $fresh->password_hash));
        // This browser's session carries the new password's fingerprint, so it
        // stays signed in while every other session ends (AuthenticateSession).
        $this->assertSame(
            auth('admin')->hashPasswordForCookie($fresh->password_hash),
            session('password_hash_admin'),
        );
        $this->assertSame(1, Activity::where('event', 'account.password_changed')->count());
    }
}
