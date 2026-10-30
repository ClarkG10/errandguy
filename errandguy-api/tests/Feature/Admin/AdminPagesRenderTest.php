<?php

namespace Tests\Feature\Admin;

use App\Models\AdminUser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Smoke-renders the custom System pages whose blade views were rewritten off
 * uncompiled Tailwind utilities (the admin has no Tailwind build) onto Filament
 * -native components + inline styles, plus the (empty) audit log. A render
 * exception would yield a non-200.
 */
class AdminPagesRenderTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $admin = AdminUser::forceCreate([
            'email' => 'super@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Super Admin', 'role' => 'super_admin', 'is_active' => true,
            'has_email_authentication' => true, // two-step sign-in set up
        ]);
        $this->actingAs($admin, 'admin');
    }

    public function test_platform_payment_methods_renders(): void
    {
        $this->get('/admin/platform-payment-methods')
            ->assertOk()
            ->assertSee('Method')
            ->assertSee('ErrandGuy Wallet');
    }

    public function test_my_account_renders(): void
    {
        $this->get('/admin/my-account')
            ->assertOk()
            ->assertSee('super@errandguy.test')
            ->assertSee('super_admin')
            ->assertSee('Two-step sign-in')
            ->assertSee('Authenticator app');
    }

    public function test_push_broadcast_renders(): void
    {
        $this->get('/admin/push-broadcast')
            ->assertOk()
            ->assertSee('Send a push notification');
    }

    public function test_staff_and_settings_pages_render(): void
    {
        $this->get('/admin/staff')->assertOk()->assertSee('Add staff member')->assertSee('super@errandguy.test');
        $this->get('/admin/system-configs')->assertOk()->assertSee('Platform fee (%)');
        $this->get('/admin/system-configs/platform_fee_percent/edit')->assertOk()->assertSee('Allowed: 1 to 50');
    }

    public function test_audit_log_renders_even_when_empty(): void
    {
        // Empty is the correct state until an admin-panel mutating action logs;
        // the page must still render (not error).
        $this->get('/admin/activity-logs')->assertOk();
    }
}
