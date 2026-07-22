<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Database-level money-integrity guards.
 *
 * The wallet was previously protected against double-application only by
 * application code (row locks + check-then-act existence tests), which are
 * racy and — critically — are re-implemented separately in the Laravel and
 * NestJS backends. These constraints move the guarantees into the shared
 * database, so a double refund / double payout-earning / duplicate settlement
 * is rejected no matter which backend (or which racing request) writes the row.
 *
 * SAFETY: each guard is added only if the existing data is already clean. If
 * legacy rows already violate a guard (e.g. a historical double-credit, or a
 * negative balance produced by the very bugs this closes), the guard is SKIPPED
 * with a loud CRITICAL log instead of failing the deploy or — far worse —
 * silently deleting money rows. Reconcile the flagged rows and re-run the
 * migration to finish applying the guard.
 *
 * Driver-aware: partial UNIQUE indexes work on both Postgres (prod) and SQLite
 * (test suite); CHECK constraints are Postgres-only (SQLite cannot ALTER TABLE
 * ADD CONSTRAINT), so they are guarded behind the driver check.
 */
return new class extends Migration
{
    public function up(): void
    {
        $driver = DB::getDriverName();

        // 1) A given user may carry at most ONE transaction of a given type for
        //    a given reference. Kills double-refund (user, reference, 'refund'),
        //    double booking-charge ('payment') and double completion-earning
        //    ('earning'). Scoped by user_id — NOT reference alone — because a
        //    single reference legitimately produces one row PER user (e.g. a
        //    referral credits both the referrer and the referee a 'bonus' keyed
        //    to the same referral id). Partial (WHERE reference_id IS NOT NULL)
        //    so payouts/top-ups — which carry a NULL reference — are untouched.
        $this->createPartialUniqueIfClean(
            table: 'wallet_transactions',
            index: 'uq_wallet_tx_user_reference_type',
            columnSql: '"user_id", "reference_id", "type"',
            where: '"reference_id" IS NOT NULL',
            dupeSql: 'SELECT "user_id", "reference_id", "type", COUNT(*) AS c FROM "wallet_transactions" '
                . 'WHERE "reference_id" IS NOT NULL GROUP BY "user_id", "reference_id", "type" HAVING COUNT(*) > 1',
        );

        // 2) A gateway transaction id settles at most one Payment row.
        $this->createPartialUniqueIfClean(
            table: 'payments',
            index: 'uq_payments_gateway_tx',
            columnSql: '"gateway_tx_id"',
            where: '"gateway_tx_id" IS NOT NULL',
            dupeSql: 'SELECT "gateway_tx_id", COUNT(*) AS c FROM "payments" '
                . 'WHERE "gateway_tx_id" IS NOT NULL GROUP BY "gateway_tx_id" HAVING COUNT(*) > 1',
        );

        // 3) Value invariants — Postgres only (SQLite test DB cannot add CHECKs
        //    to an existing table, and the test data is clean by construction).
        //    NOTE: we intentionally do NOT add wallet_balance >= 0. Under the
        //    "runner owes commission" cash model a runner's balance can be
        //    legitimately negative (the service fee they owe on cash errands,
        //    netted against future earnings). Customer overdraft is still
        //    prevented at the application layer (WalletService::deduct /
        //    RunnerPayoutController both re-check the balance under a row lock).
        if ($driver === 'pgsql') {
            $this->addCheckIfClean(
                table: 'reviews',
                constraint: 'chk_reviews_rating_range',
                check: '"rating" BETWEEN 1 AND 5',
                violationSql: 'SELECT COUNT(*) AS c FROM "reviews" WHERE "rating" < 1 OR "rating" > 5',
            );
        }
    }

    public function down(): void
    {
        $driver = DB::getDriverName();

        DB::statement('DROP INDEX IF EXISTS uq_wallet_tx_user_reference_type');
        DB::statement('DROP INDEX IF EXISTS uq_payments_gateway_tx');

        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE "reviews" DROP CONSTRAINT IF EXISTS chk_reviews_rating_range');
        }
    }

    /**
     * Create a partial UNIQUE index, but only if no rows currently violate it.
     * On dirty data, log and skip rather than fail the deploy or delete rows.
     */
    private function createPartialUniqueIfClean(string $table, string $index, string $columnSql, string $where, string $dupeSql): void
    {
        $dupes = DB::select($dupeSql);
        if (! empty($dupes)) {
            Log::critical("[money-integrity] SKIPPING unique index {$index}: {$table} has ".count($dupes)
                .' duplicate group(s). Reconcile these rows and re-run the migration to apply the guard.',
                ['sample' => array_slice($dupes, 0, 10)]);

            return;
        }

        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS {$index} ON \"{$table}\" ({$columnSql}) WHERE {$where}");
    }

    /**
     * Add a CHECK constraint, but only if no rows currently violate it.
     */
    private function addCheckIfClean(string $table, string $constraint, string $check, string $violationSql): void
    {
        $violations = (int) (DB::selectOne($violationSql)->c ?? 0);
        if ($violations > 0) {
            Log::critical("[money-integrity] SKIPPING check {$constraint}: {$table} has {$violations} violating row(s). "
                .'Reconcile these rows and re-run the migration to apply the guard.');

            return;
        }

        // NOT VALID keeps the DDL fast (no full-table scan) since we just
        // confirmed the data is clean; new/updated rows are still enforced.
        DB::statement("ALTER TABLE \"{$table}\" ADD CONSTRAINT {$constraint} CHECK ({$check}) NOT VALID");
        DB::statement("ALTER TABLE \"{$table}\" VALIDATE CONSTRAINT {$constraint}");
    }
};
