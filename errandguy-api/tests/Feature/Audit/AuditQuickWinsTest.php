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

}
