<?php

namespace Tests\Feature\Admin;

use App\Filament\Pages\Auth\StaffLogin;
use App\Models\AdminUser;
use App\Notifications\StaffSignInCode;
use Filament\Facades\Filament;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use Spatie\Activitylog\Models\Activity;
use Tests\TestCase;

/**
 * Staff sign-in: two-step sign-in is required for every role, "keep me signed
 * in" lasts 14 days, 5 failed attempts lock an account for 15 minutes, and
 * every sign-in and failed attempt is audited with the IP.
 */
class StaffSignInTest extends TestCase
{
    use RefreshDatabase;

    private function staff(string $role = 'support', array $attributes = []): AdminUser
    {
        return AdminUser::forceCreate([
            'email' => "{$role}@errandguy.test",
            'password_hash' => Hash::make('Correct-horse-1'),
            'full_name' => ucfirst($role).' Person',
            'role' => $role,
            'is_active' => true,
            ...$attributes,
        ]);
    }

    private function attempt(string $email, string $password): \Livewire\Features\SupportTesting\Testable
    {
        return Livewire::test(StaffLogin::class)
            ->fillForm(['email' => $email, 'password' => $password])
            ->call('authenticate');
    }

    public function test_two_step_sign_in_is_required_for_every_role(): void
    {
        $panel = Filament::getPanel('admin');

        $this->assertTrue($panel->isMultiFactorAuthenticationRequired());
        $this->assertSame(['app', 'email_code'], array_keys($panel->getMultiFactorAuthenticationProviders()));

        foreach (AdminUser::ROLES as $role) {
            $this->flushSession();
            $this->actingAs($this->staff($role), 'admin');

            $this->get('/admin')->assertRedirect($panel->getSetUpRequiredMultiFactorAuthenticationUrl());
            $this->get('/admin/my-account')->assertRedirect($panel->getSetUpRequiredMultiFactorAuthenticationUrl());
        }

        $enrolled = $this->staff('ops_enrolled', ['role' => 'ops', 'has_email_authentication' => true]);
        $this->flushSession();
        $this->actingAs($enrolled, 'admin');
        $this->get('/admin')->assertOk();
    }

    public function test_the_set_up_page_offers_an_authenticator_app_or_emailed_codes(): void
    {
        $this->actingAs($this->staff(), 'admin');

        $this->get(Filament::getPanel('admin')->getSetUpRequiredMultiFactorAuthenticationUrl())
            ->assertOk()
            ->assertSee('Authenticator app')
            ->assertSee('Email verification codes');

        // The authenticator-app QR code can be drawn with what's installed.
        $app = Filament::getPanel('admin')->getMultiFactorAuthenticationProviders()['app'];
        $this->assertStringStartsWith('data:image/', $app->generateQrCodeDataUri($app->generateSecret()));

        // The emailed code is sent straight away, not queued.
        $mail = (new StaffSignInCode('482913', 10))->toMail($this->staff('ops'));
        $this->assertStringContainsString('482913', implode(' ', $mail->introLines));
        $this->assertNotInstanceOf(\Illuminate\Contracts\Queue\ShouldQueue::class, new StaffSignInCode('482913', 10));
    }

    public function test_staff_files_outside_the_panel_also_need_two_step_sign_in(): void
    {
        $this->actingAs($this->staff('support'), 'admin');
        $this->get('/internal/admin/sos-alarm')->assertForbidden();

        $this->flushSession();
        $this->actingAs($this->staff('support_enrolled', ['role' => 'support', 'has_email_authentication' => true]), 'admin');
        $this->get('/internal/admin/sos-alarm')->assertOk();
    }

    public function test_keep_me_signed_in_lasts_fourteen_days(): void
    {
        $this->staff();

        Livewire::test(StaffLogin::class)
            ->fillForm(['email' => 'support@errandguy.test', 'password' => 'Correct-horse-1', 'remember' => true])
            ->call('authenticate')
            ->assertHasNoFormErrors();

        $cookie = collect(Cookie::getQueuedCookies())
            ->first(fn ($c): bool => str_starts_with($c->getName(), Auth::guard('admin')->getRecallerName()));

        $this->assertNotNull($cookie, 'signing in with "keep me signed in" sets the remember cookie');
        $this->assertEqualsWithDelta(now()->addDays(14)->getTimestamp(), $cookie->getExpiresTime(), 60);
    }

    public function test_a_sign_in_is_audited_with_the_ip_and_stamps_last_sign_in(): void
    {
        $staff = $this->staff();

        $this->attempt('support@errandguy.test', 'Correct-horse-1')->assertHasNoFormErrors();

        $this->assertAuthenticatedAs($staff, 'admin');
        $this->assertNotNull($staff->fresh()->last_login_at);

        $entry = Activity::where('event', 'auth.signed_in')->sole();
        $this->assertSame($staff->id, $entry->causer_id);
        $this->assertSame('127.0.0.1', $entry->properties['ip']);
        $this->assertSame('not set up yet', $entry->properties['two_step']);
    }

    public function test_failed_attempts_are_audited_with_the_reason(): void
    {
        $staff = $this->staff();

        $this->attempt('support@errandguy.test', 'wrong')->assertHasFormErrors(['email']);
        $this->attempt('nobody@errandguy.test', 'wrong')->assertHasFormErrors(['email']);

        $this->assertGuest('admin');

        $failures = Activity::where('event', 'auth.sign_in_failed')->orderBy('id')->get();
        $this->assertCount(2, $failures);
        $this->assertSame('wrong password', $failures[0]->properties['reason']);
        $this->assertSame($staff->id, $failures[0]->subject_id);
        $this->assertSame('127.0.0.1', $failures[0]->properties['ip']);
        $this->assertSame('no staff account with this email', $failures[1]->properties['reason']);
        $this->assertSame('nobody@errandguy.test', $failures[1]->properties['email']);
    }

    public function test_five_failures_lock_the_account_for_fifteen_minutes_whatever_the_ip(): void
    {
        $this->staff();

        // Spread over five minutes, so the per-IP limit (5 a minute) never
        // trips: only the per-account lock can stop the sixth try.
        for ($i = 0; $i < 5; $i++) {
            // Counted by address, however it is capitalised.
            $this->attempt($i % 2 ? 'Support@errandguy.test' : 'support@errandguy.test', 'wrong')->assertHasFormErrors(['email']);
            $this->travel(61)->seconds();
        }

        $this->assertSame(1, Activity::where('event', 'auth.sign_in_locked')->count());

        // Even the right password is refused while locked.
        $this->attempt('support@errandguy.test', 'Correct-horse-1');
        $this->assertGuest('admin');
        $this->assertSame('locked after too many failed attempts', Activity::where('event', 'auth.sign_in_failed')->latest('id')->first()->properties['reason']);

        // Another account is unaffected.
        $finance = $this->staff('finance');
        $this->attempt('finance@errandguy.test', 'Correct-horse-1');
        $this->assertAuthenticatedAs($finance, 'admin');
        Auth::guard('admin')->logout();

        // The lock lifts after 15 minutes.
        $this->travel(16)->minutes();
        $this->attempt('support@errandguy.test', 'Correct-horse-1')->assertHasNoFormErrors();
        $this->assertAuthenticated('admin');
    }

    public function test_a_disabled_account_is_refused_before_any_code_is_sent(): void
    {
        Notification::fake();
        $this->staff('support', ['is_active' => false, 'has_email_authentication' => true]);

        $this->attempt('support@errandguy.test', 'Correct-horse-1')->assertHasFormErrors(['email']);

        $this->assertGuest('admin');
        Notification::assertNothingSent();
        $this->assertSame('account disabled', Activity::where('event', 'auth.sign_in_failed')->sole()->properties['reason']);
    }

    public function test_an_emailed_code_completes_sign_in_and_a_wrong_code_counts_as_a_failure(): void
    {
        Notification::fake();
        $staff = $this->staff('support', ['has_email_authentication' => true]);

        $page = $this->attempt('support@errandguy.test', 'Correct-horse-1')->assertHasNoFormErrors();

        // Password right: not signed in yet, a code is on its way.
        $this->assertGuest('admin');
        $code = null;
        Notification::assertSentTo($staff, StaffSignInCode::class, function (StaffSignInCode $n) use (&$code): bool {
            $code = $n->code;

            return true;
        });

        $page->set('data.multiFactor.email_code.code', $code === '000000' ? '111111' : '000000')
            ->call('authenticate')
            ->assertHasErrors();
        $this->assertGuest('admin');
        $this->assertSame('wrong two-step code', Activity::where('event', 'auth.sign_in_failed')->sole()->properties['reason']);

        $page->set('data.multiFactor.email_code.code', $code)
            ->call('authenticate')
            ->assertHasNoErrors();

        $this->assertAuthenticatedAs($staff, 'admin');
        $this->assertSame('Email', Activity::where('event', 'auth.signed_in')->sole()->properties['two_step']);
    }
}
