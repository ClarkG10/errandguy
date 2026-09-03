<?php

namespace Tests\Feature\Audit;

use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\DisputeTicket;
use App\Models\ErrandType;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Covers the safe quick-wins surfaced by the 2026-08-13 production-readiness
 * audit: a deep /health probe, short-lived admin tokens, the wallet-ledger
 * gateway-internal leak, and the ops dispute-count blindspot.
 */
class AuditQuickWinsTest extends TestCase
{
    use RefreshDatabase;

    private function admin(string $role = 'admin'): AdminUser
    {
        return AdminUser::create([
            'email' => $role.'@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => ucfirst($role), 'role' => $role, 'is_active' => true,
        ]);
    }

    public function test_deep_health_probe_reports_ok_when_db_and_cache_are_up(): void
    {
        // `status` now also reflects scheduler liveness (a dead cron means no
        // backups and no money reconciliation, so "ok" would be dishonest —
        // see SchedulerHealthTest). Seed a fresh heartbeat so this test keeps
        // asserting what it is actually about: the DB and cache probes.
        \Illuminate\Support\Facades\Cache::put('scheduler:heartbeat', now()->timestamp, 900);

        $this->getJson('/health')
            ->assertOk()
            ->assertJsonPath('status', 'ok')
            ->assertJsonPath('checks.database', 'up')
            ->assertJsonPath('checks.cache', 'up');
    }

    public function test_admin_login_issues_a_short_lived_token(): void
    {
        $this->admin();

        $this->postJson('/api/v1/admin/login', ['email' => 'admin@errandguy.test', 'password' => 'Password1!'])
            ->assertOk();

        $token = \Laravel\Sanctum\PersonalAccessToken::first();
        $this->assertNotNull($token->expires_at, 'admin token must carry an absolute expiry');
        // ~8h out (not the 30-day global default).
        $this->assertLessThanOrEqual(9 * 60, now()->diffInMinutes($token->expires_at));
        $this->assertGreaterThanOrEqual(7 * 60, now()->diffInMinutes($token->expires_at));
    }

    public function test_wallet_transaction_hides_the_gateway_reference(): void
    {
        $tx = new WalletTransaction([
            'user_id' => (string) \Illuminate\Support\Str::uuid(),
            'type' => 'topup', 'amount' => 100, 'balance_after' => 100,
            'gateway_ref' => 'xnd_secret_ref_123', 'status' => 'completed',
        ]);

        $array = $tx->toArray();
        $this->assertArrayNotHasKey('gateway_ref', $array, 'gateway_ref must not serialize to the client');
        $this->assertArrayHasKey('amount', $array); // a normal field still shows
        // Direct property access (used by internal callers) is unaffected.
        $this->assertSame('xnd_secret_ref_123', $tx->gateway_ref);
    }

    public function test_dashboard_counts_open_and_escalated_disputes_not_a_nonexistent_active_status(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'd', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);
        $booking = Booking::create([
            'booking_number' => 'EG-20260813-DSP1', 'customer_id' => $customer->id,
            'errand_type_id' => $errandType->id, 'status' => 'completed', 'pickup_address' => 'a',
            'pickup_lat' => 14.6, 'pickup_lng' => 120.98, 'dropoff_address' => 'b', 'dropoff_lat' => 14.55,
            'dropoff_lng' => 121.02, 'schedule_type' => 'now', 'pricing_mode' => 'fixed',
            'vehicle_type_rate' => 'motorcycle', 'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50,
            'service_fee' => 15, 'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);
        foreach (['open', 'escalated', 'resolved'] as $status) {
            DisputeTicket::create([
                'booking_id' => $booking->id, 'reported_by' => $customer->id,
                'category' => 'payment', 'description' => 'x', 'status' => $status,
            ]);
        }

        Sanctum::actingAs($this->admin());
        $this->getJson('/api/v1/admin/dashboard/stats')
            ->assertOk()
            // open + escalated = 2 (the resolved one is excluded); pre-fix this was 0.
            ->assertJsonPath('data.disputes.active', 2);
    }
}
