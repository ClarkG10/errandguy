<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Bound the growth of the two money-path dedup tables, which otherwise grow
 * forever — one row per money-mutating request (idempotency_keys) and one per
 * provider webhook (webhook_events). (DATA-9)
 *
 * Both are pruned only OUTSIDE their replay window, so pruning can never
 * re-enable a duplicate:
 *   - idempotency_keys: the middleware honours a key for 24h (expires_at =
 *     now()+1 day); a row whose expires_at is older than the retention is dead
 *     and safe to drop. Pruned on the indexed expires_at column.
 *   - webhook_events: only a 'processed' row short-circuits a redelivery, and
 *     the underlying payment ops are themselves idempotent (a re-processed
 *     event finds the payment already settled and no-ops), so pruning is
 *     money-safe regardless. A generous default keeps the events as a financial
 *     audit trail well beyond any provider redelivery window.
 *
 * Deletes in bounded batches via select-then-delete-by-id so a large backlog
 * never holds a long lock, and it stays portable across MySQL (prod) and SQLite
 * (tests) — DELETE ... LIMIT is MySQL-only.
 */
class PruneDedupRecordsCommand extends Command
{
    protected $signature = 'errandguy:prune-dedup-records
        {--idempotency-days=7 : Delete idempotency_keys whose 24h window expired more than this many days ago}
        {--webhook-days=90 : Delete webhook_events older than this many days (kept as an audit trail until then)}
        {--batch=1000 : Max rows deleted per statement (keeps each delete short)}';

    protected $description = 'Prune expired idempotency_keys and old webhook_events to bound money-path dedup-table growth (DATA-9).';

    public function handle(): int
    {
        $batch = max(1, (int) $this->option('batch'));

        $idemDeleted = $this->pruneInBatches(
            'idempotency_keys',
            'expires_at',
            now()->subDays((int) $this->option('idempotency-days')),
            $batch,
        );

        $webhookDeleted = $this->pruneInBatches(
            'webhook_events',
            'created_at',
            now()->subDays((int) $this->option('webhook-days')),
            $batch,
        );

        Log::info("Pruned dedup records: {$idemDeleted} idempotency_keys, {$webhookDeleted} webhook_events.");
        $this->info("Pruned {$idemDeleted} idempotency_keys and {$webhookDeleted} webhook_events.");

        return self::SUCCESS;
    }

    /**
     * Delete rows of $table whose $column is strictly before $cutoff, in bounded
     * batches. Select-then-delete-by-id keeps it portable (no DELETE ... LIMIT).
     */
    private function pruneInBatches(string $table, string $column, Carbon $cutoff, int $batchSize = 1000): int
    {
        $total = 0;

        do {
            $ids = DB::table($table)
                ->where($column, '<', $cutoff)
                ->limit($batchSize)
                ->pluck('id');

            if ($ids->isEmpty()) {
                break;
            }

            $total += DB::table($table)->whereIn('id', $ids)->delete();
        } while ($ids->count() === $batchSize);

        return $total;
    }
}
