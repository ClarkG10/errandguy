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
 * Guard-if-clean, applied on Postgres AND MySQL: SQLite (the :memory: test DB)
 * cannot ALTER TABLE ADD a foreign key and its data is clean by construction,
 * so it is skipped; a dirty legacy row logs a CRITICAL and skips rather than
 * failing the deploy.
 */
return new class extends Migration
{
    public function up(): void
    {
        $driver = DB::getDriverName();
        if ($driver !== 'pgsql' && $driver !== 'mysql' && $driver !== 'mariadb') {
            return; // sqlite: cannot ALTER TABLE ADD FK; data clean by construction
        }

        $ansi = $driver === 'pgsql';
        $q = fn (string $id): string => $ansi ? "\"{$id}\"" : "`{$id}`";

        $orphans = (int) (DB::selectOne(
            'SELECT COUNT(*) AS c FROM '.$q('bookings').' b WHERE b.'.$q('promo_code_id').' IS NOT NULL '
            .'AND NOT EXISTS (SELECT 1 FROM '.$q('promo_codes').' p WHERE p.'.$q('id').' = b.'.$q('promo_code_id').')'
        )->c ?? 0);

        if ($orphans > 0) {
            Log::critical("[referential] SKIPPING fk bookings.promo_code_id -> promo_codes.id: {$orphans} orphan row(s). Reconcile and re-run.");

            return;
        }

        if ($ansi) {
            // Postgres: NOT VALID keeps the DDL fast — data already confirmed clean.
            DB::statement('ALTER TABLE "bookings" ADD CONSTRAINT fk_bookings_promo_code FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes" ("id") ON DELETE SET NULL NOT VALID');
            DB::statement('ALTER TABLE "bookings" VALIDATE CONSTRAINT fk_bookings_promo_code');

            return;
        }

        // MySQL / MariaDB — no NOT VALID; the FK validates existing rows on add
        // (already confirmed orphan-free above). MySQL auto-creates the backing
        // index on promo_code_id if one does not already exist.
        if (! $this->fkExists('bookings', 'fk_bookings_promo_code')) {
            DB::statement('ALTER TABLE `bookings` ADD CONSTRAINT fk_bookings_promo_code '
                .'FOREIGN KEY (`promo_code_id`) REFERENCES `promo_codes` (`id`) ON DELETE SET NULL');
        }
    }

    public function down(): void
    {
        $driver = DB::getDriverName();

        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS fk_bookings_promo_code');
        } elseif (($driver === 'mysql' || $driver === 'mariadb') && $this->fkExists('bookings', 'fk_bookings_promo_code')) {
            DB::statement('ALTER TABLE `bookings` DROP FOREIGN KEY fk_bookings_promo_code');
        }
    }

    /** MySQL: does a foreign-key constraint of this name exist on the table? */
    private function fkExists(string $table, string $name): bool
    {
        return DB::selectOne(
            'SELECT 1 FROM information_schema.table_constraints '
            .'WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_name = ? '
            ."AND constraint_type = 'FOREIGN KEY' LIMIT 1",
            [$table, $name]
        ) !== null;
    }
};
