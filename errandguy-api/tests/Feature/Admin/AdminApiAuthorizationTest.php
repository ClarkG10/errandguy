<?php

namespace Tests\Feature\Admin;

use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\DisputeTicket;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
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

    public function test_support_admin_is_forbidden_from_the_payout_ledger(): void
    {
        // GET /payouts returns the full payout ledger + runner PII (name/phone);
        // it's money data, so support/ops must be barred like the mutating routes.
        $this->actingAsAdmin('support');
        $this->getJson('/api/v1/admin/payouts')->assertStatus(403);
    }

    public function test_finance_admin_can_read_the_payout_ledger(): void
    {
        $this->actingAsAdmin('finance');
        $this->getJson('/api/v1/admin/payouts')->assertOk();
    }

    public function test_finance_admin_is_forbidden_from_the_dispute_read_routes(): void
    {
        // Finance can manage money but NOT handle support; the disputes surface
        // (both parties' phone + email) must be closed to them over the API too,
        // matching the Filament DisputeTicketResource gate. The READ routes were
        // previously ungated, leaking dispute PII across the privilege boundary.
        $this->actingAsAdmin('finance');

        $this->getJson('/api/v1/admin/disputes')->assertStatus(403);
        $this->getJson('/api/v1/admin/disputes/'.Str::uuid())->assertStatus(403);
    }

    public function test_support_admin_can_read_the_dispute_list(): void
    {
        $this->actingAsAdmin('support');

        $this->getJson('/api/v1/admin/disputes')->assertOk();
    }

    public function test_dispute_resolve_persists_resolution_and_resolver(): void
    {
        Queue::fake(); // resolve() dispatches a reporter push we don't exercise here
        $admin = $this->actingAsAdmin('support');

        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'd', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);
        $booking = Booking::create([
            'booking_number' => 'EG-20260331-DSPX', 'customer_id' => $customer->id,
            'errand_type_id' => $errandType->id, 'status' => 'completed', 'pickup_address' => 'a',
            'pickup_lat' => 14.6, 'pickup_lng' => 120.98, 'dropoff_address' => 'b', 'dropoff_lat' => 14.55,
            'dropoff_lng' => 121.02, 'schedule_type' => 'now', 'pricing_mode' => 'fixed',
            'vehicle_type_rate' => 'motorcycle', 'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50,
            'service_fee' => 15, 'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);
        $dispute = DisputeTicket::create([
            'booking_id' => $booking->id, 'reported_by' => $customer->id,
            'category' => 'payment', 'description' => 'Overcharged', 'status' => 'open',
        ]);

        $this->postJson("/api/v1/admin/disputes/{$dispute->id}/resolve", [
            'resolution_note' => 'Refunded customer, closing',
        ])->assertOk();

        // The note must land in the real `resolution` column (not the silently
        // dropped resolution_note), and the resolver must be recorded.
        $this->assertDatabaseHas('dispute_tickets', [
            'id' => $dispute->id,
            'status' => 'resolved',
            'resolution' => 'Refunded customer, closing',
            'resolved_by' => $admin->id,
        ]);
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
