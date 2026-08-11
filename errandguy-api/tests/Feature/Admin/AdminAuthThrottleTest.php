<?php

namespace Tests\Feature\Admin;

use App\Models\AdminUser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Admin login must use the credential+IP 'login' limiter, NOT the credential-only
 * 'auth' limiter. Keying on the email alone let anyone who knew an admin's email
 * lock that admin out of the ops console with 5 junk attempts from any IP — the
 * AUTHX-3 pre-auth lockout DoS the user-login route already fixed. Mirrors
 * tests/Feature/Auth/LoginTest.php::test_attacker_cannot_lock_out_a_victim_from_another_ip.
 */
class AdminAuthThrottleTest extends TestCase
{
    use RefreshDatabase;

    public function test_attacker_cannot_lock_out_an_admin_from_another_ip(): void
    {
        AdminUser::create([
            'email' => 'ops@errandguy.test',
            'password_hash' => Hash::make('CorrectHorse!1'),
            'full_name' => 'Ops Admin',
            'role' => 'admin',
            'is_active' => true,
        ]);

        // Attacker at one IP burns the 5-attempt per-credential cap.
        $this->withServerVariables(['REMOTE_ADDR' => '9.9.9.9']);
        for ($i = 0; $i < 6; $i++) {
            $this->postJson('/api/v1/admin/login', [
                'email' => 'ops@errandguy.test',
                'password' => 'WrongPassword!',
            ]);
        }

        // The real admin, on their OWN IP with the correct password, still gets in.
        // Under the old 'auth' limiter the counter was 'auth:<email>' (global), so
        // this returned 429; under 'login' it is 'login:<email>|<ip>', scoped away
        // from the attacker's IP.
        $this->withServerVariables(['REMOTE_ADDR' => '1.2.3.4']);
        $this->postJson('/api/v1/admin/login', [
            'email' => 'ops@errandguy.test',
            'password' => 'CorrectHorse!1',
        ])->assertStatus(200);
    }

    public function test_brute_force_from_a_single_ip_is_still_capped(): void
    {
        AdminUser::create([
            'email' => 'ops2@errandguy.test',
            'password_hash' => Hash::make('CorrectHorse!1'),
            'full_name' => 'Ops Admin 2',
            'role' => 'admin',
            'is_active' => true,
        ]);

        // Same attacker IP: after 5 wrong attempts the 6th is throttled (429) —
        // the credential+IP swap must NOT weaken single-source brute-force limits.
        $this->withServerVariables(['REMOTE_ADDR' => '5.5.5.5']);
        $statuses = [];
        for ($i = 0; $i < 6; $i++) {
            $statuses[] = $this->postJson('/api/v1/admin/login', [
                'email' => 'ops2@errandguy.test',
                'password' => 'WrongPassword!',
            ])->status();
        }

        $this->assertContains(429, $statuses, 'a single IP must still be capped at 5 attempts / 15 min');
    }
}
