<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Drop a provably-redundant duplicate index on `messages`.
 *
 * Two migrations created the SAME index on (booking_id, created_at):
 *
 *   - 2026_03_26_200010_create_messages_table  → idx_messages_booking_id_created
 *   - 2026_05_06_000001_add_perf_indexes_*      → idx_messages_booking_created
 *
 * The May migration's author believed the composite was missing, but they
 * were comparing against the 2026_04_29 hot-path migration (which added
 * (booking_id, sender_id, read_at)) and overlooked that the table-CREATION
 * migration already had the exact (booking_id, created_at) index. So the two
 * are byte-for-byte interchangeable for the planner: every "latest message /
 * chat history / DISTINCT ON inbox" read the May index was meant to serve is
 * served just as well by the original. Carrying both only doubles the write
 * amplification and storage on a hot, frequently-inserted table.
 *
 * SAFETY: we drop idx_messages_booking_created ONLY after confirming the
 * keeper (idx_messages_booking_id_created) still exists — so query coverage
 * can never be lost. If the keeper is somehow absent, we SKIP with a loud
 * CRITICAL log rather than leave the read path unindexed.
 *
 * Driver-aware:
 *   - Postgres (prod-legacy) uses DROP INDEX CONCURRENTLY to avoid an ACCESS
 *     EXCLUSIVE lock on the hot messages table — which is why this migration
 *     runs OUTSIDE a transaction.
 *   - MySQL has no `IF EXISTS`/`CONCURRENTLY` on DROP INDEX and requires the
 *     owning table, so we pre-check the catalog and issue a plain scoped drop.
 *   - SQLite (test suite) uses a plain `DROP INDEX IF EXISTS`.
 */
return new class extends Migration
{
    /**
     * CONCURRENTLY cannot run inside a transaction block; disable the
     * implicit migration transaction for this migration.
     */
    public $withinTransaction = false;

    private const KEEP = 'idx_messages_booking_id_created';
    private const DROP = 'idx_messages_booking_created';

    public function up(): void
    {
        $driver = DB::getDriverName();

        // Never drop the duplicate unless the keeper is provably present.
        if (! $this->indexExists(self::KEEP, $driver)) {
            Log::critical('[index-cleanup] SKIPPING drop of '.self::DROP.': keeper index '
                .self::KEEP.' not found — dropping would leave messages(booking_id, created_at) '
                .'unindexed. Investigate the schema before re-running.');

            return;
        }

        if (! $this->indexExists(self::DROP, $driver)) {
            return; // already dropped — nothing to do
        }

        match ($driver) {
            'pgsql' => DB::statement('DROP INDEX CONCURRENTLY IF EXISTS '.self::DROP),
            'mysql', 'mariadb' => DB::statement('DROP INDEX `'.self::DROP.'` ON `messages`'),
            default => DB::statement('DROP INDEX IF EXISTS '.self::DROP), // sqlite
        };
    }

    public function down(): void
    {
        $driver = DB::getDriverName();

        if ($this->indexExists(self::DROP, $driver)) {
            return; // already present — nothing to recreate
        }

        match ($driver) {
            'pgsql' => DB::statement('CREATE INDEX CONCURRENTLY IF NOT EXISTS '.self::DROP
                .' ON "messages" ("booking_id", "created_at")'),
            'mysql', 'mariadb' => DB::statement('CREATE INDEX `'.self::DROP
                .'` ON `messages` (`booking_id`, `created_at`)'),
            default => DB::statement('CREATE INDEX IF NOT EXISTS '.self::DROP
                .' ON "messages" ("booking_id", "created_at")'), // sqlite
        };
    }

    private function indexExists(string $name, string $driver): bool
    {
        if ($driver === 'pgsql') {
            return DB::selectOne(
                'SELECT 1 FROM pg_indexes WHERE indexname = ? AND tablename = ?',
                [$name, 'messages']
            ) !== null;
        }

        if ($driver === 'mysql' || $driver === 'mariadb') {
            return DB::selectOne(
                'SELECT 1 FROM information_schema.statistics '
                .'WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1',
                ['messages', $name]
            ) !== null;
        }

        // SQLite (and any other driver) — portable catalog query.
        return DB::selectOne(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ? AND tbl_name = ?",
            [$name, 'messages']
        ) !== null;
    }
};
