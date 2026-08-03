<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Database-level money-integrity guards.
 *
 * The wallet was previously protected against double-application only by
 * application code (row locks + check-then-act existence tests), which are
 * racy. These constraints move the guarantees into the database, so a double
 * refund / double payout-earning / duplicate settlement is rejected no matter
 * which racing request writes the row.
 *
 * SAFETY: each guard is added only if the existing data is already clean. If
 * legacy rows already violate a guard (e.g. a historical double-credit, or a
 * negative balance produced by the very bugs this closes), the guard is SKIPPED
 * with a loud CRITICAL log instead of failing the deploy or — far worse —
 * silently deleting money rows. Reconcile the flagged rows and re-run the
 * migration to finish applying the guard.
 *
 * Driver-aware:
 *   - Postgres: partial UNIQUE indexes (WHERE ... IS NOT NULL) + CHECK ... NOT
 *     VALID / VALIDATE CONSTRAINT.
 *   - MySQL 8+: no partial indexes, but a plain UNIQUE index already treats
 *     NULLs as distinct, giving the SAME "only enforced when the column IS NOT
 *     NULL" semantics; CHECK constraints are enforced natively (8.0.16+).
 *   - SQLite (test suite): partial UNIQUE indexes work; CHECK constraints
 *     cannot be added to an existing table, so they are skipped there.
 */
return new class extends Migration
{
    public function up(): void
    {
        // 1) At most ONE transaction per (user, reference, type) — kills
        //    double-refund (user, reference, 'refund'), double booking-charge
        //    ('payment') and double completion-earning ('earning'). Scoped by
        //    user_id — NOT reference alone — because a single reference
        //    legitimately produces one row PER user (a referral credits both
        //    referrer and referee a 'bonus' keyed to the same referral id).
        //    Partial on reference_id IS NOT NULL so NULL-reference payouts/
        //    top-ups are untouched.
        $this->createUniqueGuardIfClean(
            table: 'wallet_transactions',
            index: 'uq_wallet_tx_user_reference_type',
            columns: ['user_id', 'reference_id', 'type'],
            notNull: 'reference_id',
        );

        // 2) A gateway transaction id settles at most one Payment row.
        $this->createUniqueGuardIfClean(
            table: 'payments',
            index: 'uq_payments_gateway_tx',
            columns: ['gateway_tx_id'],
            notNull: 'gateway_tx_id',
        );

        // 3) reviews.rating ∈ [1,5]. NOTE: we intentionally do NOT add
        //    wallet_balance >= 0 — under the "runner owes commission" cash model
        //    a runner's balance can be legitimately negative. Customer overdraft
        //    is prevented at the application layer under a row lock.
        $this->addRatingCheckIfClean();
    }

    public function down(): void
    {
        $driver = DB::getDriverName();

        if ($driver === 'mysql' || $driver === 'mariadb') {
            foreach ([
                'uq_wallet_tx_user_reference_type' => 'wallet_transactions',
                'uq_payments_gateway_tx' => 'payments',
            ] as $index => $table) {
                if ($this->indexExists($table, $index)) {
                    DB::statement("DROP INDEX `{$index}` ON `{$table}`");
                }
            }

            if ($this->checkExists('reviews', 'chk_reviews_rating_range')) {
                DB::statement('ALTER TABLE `reviews` DROP CHECK chk_reviews_rating_range');
            }

            return;
        }

        DB::statement('DROP INDEX IF EXISTS uq_wallet_tx_user_reference_type');
        DB::statement('DROP INDEX IF EXISTS uq_payments_gateway_tx');

        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE "reviews" DROP CONSTRAINT IF EXISTS chk_reviews_rating_range');
        }
    }

    /**
     * Create a UNIQUE guard on $columns, but only if no rows currently violate
     * it (skip-and-log on dirty data rather than fail the deploy or delete
     * rows). Partial (WHERE $notNull IS NOT NULL) on Postgres/SQLite; a plain
     * UNIQUE on MySQL, where NULLs are distinct so the effect is identical.
     */
    private function createUniqueGuardIfClean(string $table, string $index, array $columns, string $notNull): void
    {
        $driver = DB::getDriverName();
        $mysql = $driver === 'mysql' || $driver === 'mariadb';
        $q = fn (string $id): string => $mysql ? "`{$id}`" : "\"{$id}\"";
        $cols = implode(', ', array_map($q, $columns));

        $dupes = DB::select(
            'SELECT '.$cols.', COUNT(*) AS c FROM '.$q($table)
            .' WHERE '.$q($notNull).' IS NOT NULL GROUP BY '.$cols.' HAVING COUNT(*) > 1'
        );
        if (! empty($dupes)) {
            Log::critical("[money-integrity] SKIPPING unique index {$index}: {$table} has ".count($dupes)
                .' duplicate group(s). Reconcile these rows and re-run the migration to apply the guard.',
                ['sample' => array_slice($dupes, 0, 10)]);

            return;
        }

        if ($mysql) {
            // MySQL has no IF NOT EXISTS on CREATE INDEX — guard on the catalog.
            if (! $this->indexExists($table, $index)) {
                DB::statement("CREATE UNIQUE INDEX `{$index}` ON {$q($table)} ({$cols})");
            }

            return;
        }

        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS {$index} ON {$q($table)} ({$cols}) WHERE {$q($notNull)} IS NOT NULL");
    }

    /**
     * Add the reviews.rating range CHECK if no row currently violates it.
     * Skipped on SQLite (cannot ALTER TABLE ADD CONSTRAINT on an existing table).
     */
    private function addRatingCheckIfClean(): void
    {
        $driver = DB::getDriverName();
        if ($driver === 'sqlite') {
            return;
        }

        $mysql = $driver === 'mysql' || $driver === 'mariadb';
        $violations = (int) (DB::selectOne(
            $mysql
                ? 'SELECT COUNT(*) AS c FROM `reviews` WHERE `rating` < 1 OR `rating` > 5'
                : 'SELECT COUNT(*) AS c FROM "reviews" WHERE "rating" < 1 OR "rating" > 5'
        )->c ?? 0);
        if ($violations > 0) {
            Log::critical("[money-integrity] SKIPPING check chk_reviews_rating_range: reviews has {$violations} "
                .'violating row(s). Reconcile these rows and re-run the migration to apply the guard.');

            return;
        }

        if ($mysql) {
            if (! $this->checkExists('reviews', 'chk_reviews_rating_range')) {
                DB::statement('ALTER TABLE `reviews` ADD CONSTRAINT chk_reviews_rating_range CHECK (`rating` BETWEEN 1 AND 5)');
            }

            return;
        }

        // Postgres: NOT VALID keeps the DDL fast — we just confirmed data clean.
        DB::statement('ALTER TABLE "reviews" ADD CONSTRAINT chk_reviews_rating_range CHECK ("rating" BETWEEN 1 AND 5) NOT VALID');
        DB::statement('ALTER TABLE "reviews" VALIDATE CONSTRAINT chk_reviews_rating_range');
    }

    /** MySQL: does an index of this name exist on the table (current schema)? */
    private function indexExists(string $table, string $index): bool
    {
        return DB::selectOne(
            'SELECT 1 FROM information_schema.statistics '
            .'WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1',
            [$table, $index]
        ) !== null;
    }

    /** MySQL: does a CHECK constraint of this name exist on the table? */
    private function checkExists(string $table, string $constraint): bool
    {
        return DB::selectOne(
            'SELECT 1 FROM information_schema.table_constraints '
            .'WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_name = ? '
            ."AND constraint_type = 'CHECK' LIMIT 1",
            [$table, $constraint]
        ) !== null;
    }
};
