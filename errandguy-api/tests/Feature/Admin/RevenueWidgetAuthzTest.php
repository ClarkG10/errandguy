<?php

namespace Tests\Feature\Admin;

use App\Filament\Widgets\AdminStatsOverview;
use App\Filament\Widgets\PaymentMixChart;
use App\Filament\Widgets\RevenueChart;
use App\Models\AdminUser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * Revenue/GMV dashboard widgets are money data and must be gated to money roles
 * (super_admin / finance) via canView(). Widgets have no policy fall-through, so
 * without the explicit gate the Gate::before blanket-allow rendered platform
 * revenue to support/ops. (audit 2026-08-17 H-E)
 */
class RevenueWidgetAuthzTest extends TestCase
{
    use RefreshDatabase;

    private function admin(string $role): AdminUser
    {
        return AdminUser::create([
            'email' => $role.'@errandguy.test',
            'password_hash' => Hash::make('Password1!'),
            'full_name' => ucfirst($role),
            'role' => $role,
            'is_active' => true,
        ]);
    }

    public function test_money_roles_can_see_revenue_widgets(): void
    {
        foreach ([AdminUser::ROLE_SUPER_ADMIN, AdminUser::ROLE_FINANCE] as $role) {
            $this->actingAs($this->admin($role), 'admin');
            $this->assertTrue(RevenueChart::canView(), "$role should see RevenueChart");
            $this->assertTrue(PaymentMixChart::canView(), "$role should see PaymentMixChart");
        }
    }

    public function test_non_money_roles_cannot_see_revenue_widgets(): void
    {
        foreach ([AdminUser::ROLE_SUPPORT, AdminUser::ROLE_OPS, AdminUser::ROLE_ADMIN] as $role) {
            $this->actingAs($this->admin($role), 'admin');
            $this->assertFalse(RevenueChart::canView(), "$role must not see RevenueChart");
            $this->assertFalse(PaymentMixChart::canView(), "$role must not see PaymentMixChart");
        }
    }

    public function test_overview_hides_money_stats_from_non_money_roles(): void
    {
        $this->actingAs($this->admin(AdminUser::ROLE_SUPPORT), 'admin');
        Livewire::test(AdminStatsOverview::class)
            ->assertDontSee('Platform revenue today')
            ->assertDontSee('GMV today')
            ->assertSee('Active bookings'); // non-money stats still shown
    }

    public function test_overview_shows_money_stats_to_money_roles(): void
    {
        $this->actingAs($this->admin(AdminUser::ROLE_FINANCE), 'admin');
        Livewire::test(AdminStatsOverview::class)
            ->assertSee('Platform revenue today')
            ->assertSee('GMV today');
    }
}
