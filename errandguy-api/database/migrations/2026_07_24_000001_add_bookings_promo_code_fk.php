<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Referential guard: bookings.promo_code_id had no foreign key to promo_codes.
 *
 * The column is always written as NULL or a validated promo_codes.id
 * (PromoService::validate/redeem) and promo codes are never hard-deleted
 * (toggled via is_active), so today's data is clean — this is defensive, not a
 * fix for live corruption. ON DELETE SET NULL keeps historical bookings intact
 * if a promo is ever removed.
 *
 * Postgres-only + guard-if-clean, mirroring add_money_integrity_constraints:
 * SQLite (the :memory: test DB) cannot ALTER TABLE ADD a foreign key and its
 * data is clean by construction, so it's skipped; a dirty legacy row on
 * Postgres logs a CRITICAL and skips rather than failing the deploy.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        $orphans = (int) (DB::selectOne(
            'SELECT COUNT(*) AS c FROM "bookings" b WHERE b."promo_code_id" IS NOT NULL '
            .'AND NOT EXISTS (SELECT 1 FROM "promo_codes" p WHERE p."id" = b."promo_code_id")'
        )->c ?? 0);

        if ($orphans > 0) {
            Log::critical("[referential] SKIPPING fk bookings.promo_code_id -> promo_codes.id: {$orphans} orphan row(s). Reconcile and re-run.");

            return;
        }

        // NOT VALID keeps the DDL fast (no full-table scan) since we just
        // confirmed the data is clean; new/updated rows are enforced immediately.
        DB::statement('ALTER TABLE "bookings" ADD CONSTRAINT fk_bookings_promo_code FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes" ("id") ON DELETE SET NULL NOT VALID');
        DB::statement('ALTER TABLE "bookings" VALIDATE CONSTRAINT fk_bookings_promo_code');
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS fk_bookings_promo_code');
        }
    }
};
