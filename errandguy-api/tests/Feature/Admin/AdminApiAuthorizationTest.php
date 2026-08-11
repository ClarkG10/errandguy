<?php

namespace Tests\Feature\Admin;

use App\Models\AdminUser;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The REST admin API must enforce the SAME role matrix as the Filament panel
 * (money endpoints require canManageMoney; support/moderation require
 * canHandleSupport). Previously the 'admin' gate only checked is_active, so any
 * active admin token could move money. It must also audit-log its mutations
 * (with a resolved causer) the way the Filament actions do.
 */
class AdminApiAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    private function actingAsAdmin(string $role): AdminUser
    {
        $admin = AdminUser::create([
            'email' => $role.'@errandguy.test',
            'password_hash' => Hash::make('Password1!'),
            'full_name' => ucfirst($role),
            'role' => $role,
            'is_active' => true,
        ]);
        Sanctum::actingAs($admin);

        return $admin;
    }

    // ── Money endpoints: finance / super_admin only (canManageMoney) ──

    public function test_support_admin_is_forbidden_from_a_money_endpoint(): void
    {
        $this->actingAsAdmin('support');

        $this->postJson('/api/v1/admin/payouts/'.Str::uuid().'/complete')
            ->assertStatus(403);
    }

    public function test_finance_admin_passes_the_money_capability_gate(): void
    {
        $this->actingAsAdmin('finance');

        // Non-existent payout: the capability gate passes and the controller
        // runs, so the response is anything BUT 403.
        $status = $this->postJson('/api/v1/admin/payouts/'.Str::uuid().'/complete')->status();
        $this->assertNotSame(403, $status);
    }

    // ── Support/moderation endpoints: excludes finance (canHandleSupport) ──

    public function test_finance_admin_is_forbidden_from_a_support_endpoint(): void
    {
        $this->actingAsAdmin('finance');

        $this->postJson('/api/v1/admin/disputes/'.Str::uuid().'/resolve', ['resolution_note' => 'x'])
            ->assertStatus(403);
    }

    public function test_support_admin_passes_the_support_capability_gate(): void
    {
        $this->actingAsAdmin('support');

        $status = $this->postJson('/api/v1/admin/disputes/'.Str::uuid().'/resolve', ['resolution_note' => 'x'])->status();
        $this->assertNotSame(403, $status);
    }

    // ── Moderation endpoints: super_admin/admin/ops only (canModerate) — this
    //    EXCLUDES support, unlike the support/dispute endpoints above. ──

    public function test_support_admin_is_forbidden_from_a_moderation_endpoint(): void
    {
        // Support handles disputes but NOT account moderation (which can revoke
        // sessions) or booking cancel (which refunds money) — mirroring Filament.
        $this->actingAsAdmin('support');
        $target = User::factory()->create(['status' => 'active']);

        $this->postJson("/api/v1/admin/users/{$target->id}/suspend", ['reason' => 'x'])
            ->assertStatus(403);
        // Booking cancel (a money-moving moderation action) is likewise blocked.
        $this->postJson('/api/v1/admin/bookings/'.Str::uuid().'/cancel', ['reason' => 'x'])
            ->assertStatus(403);
    }

    public function test_super_admin_passes_money_support_and_moderation_gates(): void
    {
        $this->actingAsAdmin('super_admin');

        $this->assertNotSame(403, $this->postJson('/api/v1/admin/payouts/'.Str::uuid().'/complete')->status());
        $this->assertNotSame(403, $this->postJson('/api/v1/admin/disputes/'.Str::uuid().'/resolve', ['resolution_note' => 'x'])->status());
        $this->assertNotSame(403, $this->postJson('/api/v1/admin/bookings/'.Str::uuid().'/cancel', ['reason' => 'x'])->status());
    }

    // ── Audit trail + causer resolution in the sanctum API context ──

    public function test_admin_api_mutation_is_audit_logged_with_the_acting_admin_as_causer(): void
    {
        // ops is moderation-capable (canModerate) — the correct role to suspend.
        $admin = $this->actingAsAdmin('ops');
        $target = User::factory()->create(['status' => 'active']);

        $this->postJson("/api/v1/admin/users/{$target->id}/suspend", ['reason' => 'policy breach'])
            ->assertOk();

        $this->assertDatabaseHas('activity_log', [
            'log_name' => 'admin',
            'event' => 'user.suspended',
            'causer_id' => $admin->id,
            'subject_id' => $target->id,
        ]);
    }
}
