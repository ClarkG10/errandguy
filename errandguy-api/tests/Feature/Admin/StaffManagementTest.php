<?php

namespace Tests\Feature\Admin;

use App\Exceptions\StaffAccountException;
use App\Filament\Resources\Staff\Pages\ListStaff;
use App\Filament\Resources\Staff\StaffResource;
use App\Models\AdminUser;
use App\Notifications\StaffPasswordLink;
use App\Services\StaffAccountService;
use App\Support\StaffSignIn;
use App\Filament\Pages\Auth\StaffRequestPasswordReset;
use Filament\Auth\Pages\PasswordReset\ResetPassword;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Livewire\Livewire;
use Spatie\Activitylog\Models\Activity;
use Tests\TestCase;

/**
 * The Staff page: super admins only; adding staff sends a set-password email,
 * roles change and accounts disable/enable with an audit entry, a disabled
 * account's session ends, and the panel always keeps an active super admin.
 */
class StaffManagementTest extends TestCase
{
    use RefreshDatabase;

    private AdminUser $super;

    protected function setUp(): void
    {
        parent::setUp();

        $this->super = $this->staff('super_admin');
        $this->actingAs($this->super, 'admin');
    }

    private function staff(string $role, ?string $email = null, array $attributes = []): AdminUser
    {
        return AdminUser::forceCreate([
            'email' => $email ?? "{$role}@errandguy.test",
            'password_hash' => Hash::make('Correct-horse-1'),
            'full_name' => ucfirst($role),
            'role' => $role,
            'is_active' => true,
            'has_email_authentication' => true,
            ...$attributes,
        ]);
    }

    public function test_only_super_admins_can_manage_staff(): void
    {
        $this->assertTrue(StaffResource::canViewAny());

        foreach (['admin', 'finance', 'support', 'ops'] as $role) {
            $this->flushSession();
            $this->actingAs($this->staff($role), 'admin');

            $this->assertFalse(StaffResource::canViewAny(), "{$role} must not manage staff");
            $this->assertFalse(StaffResource::canDeleteAny());
            $this->get('/admin/staff')->assertForbidden();
        }
    }

    public function test_adding_staff_emails_a_set_password_link_and_is_audited(): void
    {
        Notification::fake();

        Livewire::test(ListStaff::class)
            ->callAction('addStaff', ['full_name' => 'New Person', 'email' => 'New.Person@ErrandGuy.test', 'role' => 'support'])
            ->assertHasNoActionErrors();

        $new = AdminUser::where('email', 'new.person@errandguy.test')->sole();
        $this->assertSame('support', $new->role);
        $this->assertTrue($new->is_active);
        $this->assertNull($new->twoStepMethod(), 'they set up two-step sign-in at first sign-in');

        Notification::assertSentTo($new, StaffPasswordLink::class, function (StaffPasswordLink $n) use ($new): bool {
            return $n->isInvite
                && str_contains($n->url, '/admin/password-reset/reset')
                && str_contains($n->url, urlencode($new->email))
                && $n->toMail($new)->actionUrl === $n->url;
        });

        $this->assertSame('support', Activity::where('event', 'staff.added')->sole()->properties['role']);

        // The emailed link opens the set-password page, and setting a
        // password there works and is audited.
        $sent = Notification::sent($new, StaffPasswordLink::class)->first();
        $this->flushSession();
        auth('admin')->logout();
        $this->get($sent->url)->assertOk()->assertSee($new->email);

        Livewire::test(ResetPassword::class, ['email' => $new->email, 'token' => $sent->token])
            ->set('password', 'Chosen-pass-123')
            ->set('passwordConfirmation', 'Chosen-pass-123')
            ->call('resetPassword')
            ->assertHasNoErrors();

        $this->assertTrue(Hash::check('Chosen-pass-123', $new->fresh()->password_hash));
        $this->assertSame($new->id, Activity::where('event', 'auth.password_reset')->sole()->subject_id);
    }

    public function test_forgot_password_sends_the_staff_reset_email_straight_away(): void
    {
        Notification::fake();
        $ops = $this->staff('ops');
        $this->flushSession();
        auth('admin')->logout();

        Livewire::test(StaffRequestPasswordReset::class)
            ->set('data.email', 'ops@errandguy.test')
            ->call('request')
            ->assertHasNoErrors()
            ->assertNotified('Check your email');

        Notification::assertSentTo($ops, StaffPasswordLink::class, function (StaffPasswordLink $n) use ($ops): bool {
            return ! $n->isInvite
                && str_contains($n->url, '/admin/password-reset/reset')
                && str_contains($n->toMail($ops)->subject, 'Reset your password');
        });
        // Not queued: getting back into the panel can't wait on the queue worker.
        $this->assertNotInstanceOf(\Illuminate\Contracts\Queue\ShouldQueue::class, new StaffPasswordLink('t'));
    }

    public function test_forgot_password_answers_the_same_for_an_address_that_is_not_staff(): void
    {
        Notification::fake();
        $this->flushSession();
        auth('admin')->logout();

        // Same answer as for a real staff address: no way to learn which
        // addresses are staff (and then lock them out with wrong passwords).
        Livewire::test(StaffRequestPasswordReset::class)
            ->set('data.email', 'nobody@example.com')
            ->call('request')
            ->assertHasNoErrors()
            ->assertNotified('Check your email');

        Notification::assertNothingSent();
    }

    public function test_an_email_already_used_by_staff_is_refused(): void
    {
        Notification::fake();
        $this->staff('ops');

        Livewire::test(ListStaff::class)
            ->callAction('addStaff', ['full_name' => 'Dup', 'email' => 'ops@errandguy.test', 'role' => 'support'])
            ->assertHasActionErrors(['email' => 'unique']);

        Notification::assertNothingSent();
    }

    public function test_changing_a_role_is_audited_and_never_your_own(): void
    {
        $ops = $this->staff('ops');

        Livewire::test(ListStaff::class)
            ->assertTableActionHidden('changeRole', $this->super)
            ->callTableAction('changeRole', $ops, ['role' => 'finance'])
            ->assertHasNoTableActionErrors();

        $this->assertSame('finance', $ops->fresh()->role);
        $entry = Activity::where('event', 'staff.role_changed')->sole();
        $this->assertSame('ops', $entry->properties['old']);
        $this->assertSame('finance', $entry->properties['new']);
        $this->assertSame($this->super->id, $entry->causer_id);

        $this->expectException(StaffAccountException::class);
        app(StaffAccountService::class)->changeRole($this->super, $this->super, 'admin');
    }

    public function test_a_disabled_staff_member_is_signed_out_and_cannot_sign_back_in(): void
    {
        $ops = $this->staff('ops');
        $ops->forceFill(['remember_token' => 'old-token'])->save();

        Livewire::test(ListStaff::class)
            ->assertTableActionHidden('disable', $this->super)
            ->callTableAction('disable', $ops, ['reason' => 'Left the company'])
            ->assertHasNoTableActionErrors();

        $ops->refresh();
        $this->assertFalse($ops->is_active);
        $this->assertNotSame('old-token', $ops->remember_token, '"keep me signed in" cookies stop working');
        $this->assertSame('Left the company', Activity::where('event', 'staff.disabled')->sole()->properties['reason']);

        // Their open session ends on the next click.
        $this->flushSession();
        $this->actingAs($ops, 'admin');
        $this->get('/admin')->assertRedirect(Filament::getPanel('admin')->getLoginUrl());
        $this->assertGuest('admin');

        // Staff files outside the panel refuse them too.
        $this->actingAs($ops, 'admin');
        $this->get('/internal/admin/sos-alarm')->assertForbidden();

        // Enabled again, they can use the panel.
        $this->flushSession();
        $this->actingAs($this->super, 'admin');
        Livewire::test(ListStaff::class)->callTableAction('enable', $ops)->assertHasNoTableActionErrors();
        $this->assertTrue($ops->fresh()->is_active);
        $this->flushSession();
        $this->actingAs($ops->fresh(), 'admin');
        $this->get('/admin')->assertOk();
    }

    public function test_nobody_can_disable_their_own_account(): void
    {
        $service = app(StaffAccountService::class);

        $this->expectExceptionObject(new StaffAccountException('You can’t disable your own account.'));
        $service->disable($this->super, $this->super, 'oops');
    }

    public function test_the_last_active_super_admin_cannot_be_demoted_or_disabled(): void
    {
        $service = app(StaffAccountService::class);
        $other = $this->staff('super_admin', 'second@errandguy.test');
        $service->disable($this->super, $other, 'Left');

        // Only $this->super is an active super admin now; a (disabled) actor
        // can't take that away.
        try {
            $service->changeRole($other, $this->super, 'admin');
            $this->fail('demoting the last active super admin must be refused');
        } catch (StaffAccountException $e) {
            $this->assertStringContainsString('only active super admin', $e->getMessage());
        }

        $this->assertSame('super_admin', $this->super->fresh()->role);
    }

    public function test_reset_two_step_and_unlock_sign_in(): void
    {
        $ops = $this->staff('ops');
        for ($i = 0; $i < StaffSignIn::MAX_FAILURES; $i++) {
            StaffSignIn::recordFailure('ops@errandguy.test', $ops, 'wrong password');
        }
        $this->assertGreaterThan(0, StaffSignIn::lockedSeconds('ops@errandguy.test'));

        Livewire::test(ListStaff::class)
            ->callTableAction('unlockSignIn', $ops)
            ->callTableAction('resetTwoStep', $ops)
            ->assertHasNoTableActionErrors();

        $this->assertSame(0, StaffSignIn::lockedSeconds('ops@errandguy.test'));
        $this->assertNull($ops->fresh()->twoStepMethod());
        $this->assertSame(1, Activity::where('event', 'staff.two_step_reset')->count());
        $this->assertSame(1, Activity::where('event', 'staff.sign_in_unlocked')->count());
    }

    public function test_make_admin_still_creates_an_account_from_the_server(): void
    {
        $this->artisan('errandguy:make-admin', [
            'email' => 'cli@errandguy.test',
            '--name' => 'From CLI',
            '--role' => 'ops',
            '--password' => 'Cli-password-1',
        ])->assertSuccessful();

        $cli = AdminUser::where('email', 'cli@errandguy.test')->sole();
        $this->assertSame('ops', $cli->role);
        $this->assertTrue(Hash::check('Cli-password-1', $cli->password_hash));

        // Break-glass for a super admin who lost their phone and recovery codes.
        $cli->forceFill(['has_email_authentication' => true])->save();
        $this->artisan('errandguy:make-admin', [
            'email' => 'cli@errandguy.test', '--name' => 'From CLI', '--role' => 'ops',
            '--password' => 'Cli-password-2', '--reset-two-step' => true,
        ])->assertSuccessful();
        $this->assertNull($cli->fresh()->twoStepMethod());
    }

    private function lockOut(string $email, ?AdminUser $staff = null): void
    {
        for ($i = 0; $i < StaffSignIn::MAX_FAILURES; $i++) {
            StaffSignIn::recordFailure($email, $staff, 'wrong password');
        }
        $this->assertGreaterThan(0, StaffSignIn::lockedSeconds($email));
    }

    public function test_make_admin_reset_two_step_also_lifts_the_sign_in_lock(): void
    {
        $ops = $this->staff('ops');
        $ops->forceFill(['has_email_authentication' => true])->save();
        $this->lockOut('ops@errandguy.test', $ops);

        $this->artisan('errandguy:make-admin', [
            'email' => 'ops@errandguy.test', '--password' => 'New-password-1', '--reset-two-step' => true,
        ])->assertSuccessful();

        $this->assertSame(0, StaffSignIn::lockedSeconds('ops@errandguy.test'));
        $this->assertNull($ops->fresh()->twoStepMethod());
    }

    public function test_make_admin_unlock_on_its_own_lifts_the_lock_and_changes_nothing_else(): void
    {
        $ops = $this->staff('ops');
        $hash = $ops->password_hash;
        $this->lockOut('ops@errandguy.test', $ops);

        $this->artisan('errandguy:make-admin', ['email' => 'ops@errandguy.test', '--unlock' => true])
            ->expectsOutputToContain('Sign-in lock lifted for ops@errandguy.test.')
            ->assertSuccessful();

        $this->assertSame(0, StaffSignIn::lockedSeconds('ops@errandguy.test'));
        $fresh = $ops->fresh();
        $this->assertSame($hash, $fresh->password_hash);
        $this->assertSame('ops', $fresh->role);
        $this->assertSame($ops->full_name, $fresh->full_name);

        $this->artisan('errandguy:make-admin', ['email' => 'nobody@errandguy.test', '--unlock' => true])
            ->expectsOutputToContain('No staff account uses nobody@errandguy.test.')
            ->assertFailed();
        $this->assertNull(AdminUser::where('email', 'nobody@errandguy.test')->first());
    }

    public function test_make_admin_keeps_an_existing_accounts_name_and_role_unless_told(): void
    {
        $ops = $this->staff('ops');
        $ops->update(['full_name' => 'Renamed In Panel']);

        // A deploy re-running it with the env defaults must not undo a rename
        // or a role change made in the panel.
        $_ENV['ADMIN_NAME'] = $_SERVER['ADMIN_NAME'] = 'Deploy Name';
        $_ENV['ADMIN_ROLE'] = $_SERVER['ADMIN_ROLE'] = 'super_admin';
        try {
            $this->artisan('errandguy:make-admin', ['email' => 'ops@errandguy.test', '--password' => 'Ops-password-2'])
                ->assertSuccessful();
        } finally {
            unset($_ENV['ADMIN_NAME'], $_SERVER['ADMIN_NAME'], $_ENV['ADMIN_ROLE'], $_SERVER['ADMIN_ROLE']);
        }

        $fresh = $ops->fresh();
        $this->assertSame('Renamed In Panel', $fresh->full_name);
        $this->assertSame('ops', $fresh->role);
        $this->assertTrue(Hash::check('Ops-password-2', $fresh->password_hash));

        // Given explicitly, they change.
        $this->artisan('errandguy:make-admin', [
            'email' => 'ops@errandguy.test', '--password' => 'Ops-password-3', '--name' => 'Ops Lead', '--role' => 'admin',
        ])->assertSuccessful();
        $this->assertSame('Ops Lead', $ops->fresh()->full_name);
        $this->assertSame('admin', $ops->fresh()->role);
    }
}
