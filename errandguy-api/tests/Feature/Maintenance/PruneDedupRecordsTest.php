<?php

namespace Tests\Feature\Maintenance;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Covers errandguy:prune-dedup-records (DATA-9): expired idempotency_keys and
 * old webhook_events are pruned, while rows inside their retention window (still
 * relevant to dedup / the audit trail) are kept.
 */
class PruneDedupRecordsTest extends TestCase
{
    use RefreshDatabase;

    private function idempotencyKey(\DateTimeInterface $expiresAt): string
    {
        $id = (string) Str::uuid();
        DB::table('idempotency_keys')->insert([
            'id' => $id,
            'idem_key' => Str::random(20),
            'method' => 'POST',
            'path' => '/api/v1/bookings',
            'request_hash' => hash('sha256', $id),
            'status' => 'completed',
            'expires_at' => $expiresAt,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    }

    private function webhookEvent(\DateTimeInterface $createdAt): string
    {
        $id = (string) Str::uuid();
        DB::table('webhook_events')->insert([
            'id' => $id,
            'provider' => 'xendit',
            'event_id' => (string) Str::uuid(),
            'event_type' => 'invoice.paid',
            'status' => 'processed',
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ]);

        return $id;
    }

    public function test_prunes_expired_idempotency_keys_but_keeps_live_ones(): void
    {
        $stale = $this->idempotencyKey(now()->subDays(10)); // window died 10d ago
        $live = $this->idempotencyKey(now()->subHours(1));  // still within retention

        $this->artisan('errandguy:prune-dedup-records')->assertExitCode(0);

        $this->assertDatabaseMissing('idempotency_keys', ['id' => $stale]);
        $this->assertDatabaseHas('idempotency_keys', ['id' => $live]);
    }

    public function test_prunes_old_webhook_events_but_keeps_recent_ones(): void
    {
        $old = $this->webhookEvent(now()->subDays(100)); // past the 90d audit window
        $recent = $this->webhookEvent(now()->subDays(10));

        $this->artisan('errandguy:prune-dedup-records')->assertExitCode(0);

        $this->assertDatabaseMissing('webhook_events', ['id' => $old]);
        $this->assertDatabaseHas('webhook_events', ['id' => $recent]);
    }

    public function test_respects_the_retention_options(): void
    {
        // Expired 5 days ago: kept at the default 7d retention, pruned at 3d.
        $key = $this->idempotencyKey(now()->subDays(5));

        $this->artisan('errandguy:prune-dedup-records')->assertExitCode(0);
        $this->assertDatabaseHas('idempotency_keys', ['id' => $key]);

        $this->artisan('errandguy:prune-dedup-records', ['--idempotency-days' => '3'])->assertExitCode(0);
        $this->assertDatabaseMissing('idempotency_keys', ['id' => $key]);
    }

    public function test_prunes_across_batch_boundaries(): void
    {
        // 5 stale keys with a batch size of 2 → three delete passes (2 + 2 + 1).
        for ($i = 0; $i < 5; $i++) {
            $this->idempotencyKey(now()->subDays(10));
        }
        $live = $this->idempotencyKey(now()->subHours(1));

        $this->artisan('errandguy:prune-dedup-records', ['--batch' => '2'])->assertExitCode(0);

        $this->assertSame(1, DB::table('idempotency_keys')->count());
        $this->assertDatabaseHas('idempotency_keys', ['id' => $live]);
    }
}
