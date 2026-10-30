<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Promo codes are retired for launch, so drop everything only the redemption
 * engine used:
 *
 *   - bookings.promo_code_id (with its fk_bookings_promo_code foreign key and
 *     any index on it) and bookings.promo_redeemed;
 *   - promo_user_redemptions, then promo_codes (the redemptions table
 *     references promo_codes, so it has to go first).
 *
 * KEPT on purpose: bookings.promo_discount. It is historical money data — an
 * older booking that used a promo keeps its discount so its receipt still adds
 * up and a cash errand's commission (total_amount − runner_payout) stays right.
 * New bookings always write 0.
 *
 * Every step checks first, so a re-run after a partial failure (MySQL DDL is not
 * transactional) just finishes the job:
 *   - MySQL won't drop a column a foreign key uses, nor drop promo_codes while
 *     bookings still references it, so the key is looked up in
 *     information_schema and dropped first. 2026_07_24_000001 adds it only when
 *     the data was clean, so it may not exist at all.
 *   - SQLite (the test suite) never had that key, but it won't drop an indexed
 *     column, so any index on the columns goes first.
 *
 * down() rebuilds the structure only; the dropped rows are gone (deploy.sh
 * takes a backup right before it migrates).
 */
return new class extends Migration
{
    private const BOOKING_COLUMNS = ['promo_code_id', 'promo_redeemed'];

    private const FOREIGN_KEY = 'fk_bookings_promo_code';

    public function up(): void
    {
        if (Schema::hasTable('bookings')) {
            $this->dropPromoCodeForeignKeys();

            $columns = array_values(array_filter(
                self::BOOKING_COLUMNS,
                fn (string $column): bool => Schema::hasColumn('bookings', $column),
            ));

            if ($columns !== []) {
                foreach (Schema::getIndexes('bookings') as $index) {
                    if (! $index['primary'] && array_intersect($index['columns'], $columns) !== []) {
                        Schema::table('bookings', function (Blueprint $table) use ($index) {
                            $table->dropIndex($index['name']);
                        });
                    }
                }

                Schema::table('bookings', function (Blueprint $table) use ($columns) {
                    $table->dropColumn($columns);
                });
            }
        }

        Schema::dropIfExists('promo_user_redemptions');
        Schema::dropIfExists('promo_codes');
    }

    public function down(): void
    {
        // Mirrors 2026_03_26_200016 + the (code, is_active) index from
        // 2026_04_08_000001.
        if (! Schema::hasTable('promo_codes')) {
            Schema::create('promo_codes', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->string('code', 30)->unique();
                $table->text('description')->nullable();
                $table->string('discount_type', 10);
                $table->decimal('discount_value', 8, 2);
                $table->decimal('max_discount', 8, 2)->nullable();
                $table->decimal('min_order', 8, 2)->default(0.00);
                $table->integer('usage_limit')->nullable();
                $table->integer('per_user_limit')->default(1);
                $table->integer('used_count')->default(0);
                $table->timestampTz('valid_from');
                $table->timestampTz('valid_until');
                $table->boolean('is_active')->default(true);
                $table->timestampTz('created_at')->useCurrent();

                $table->index(['code', 'is_active']);
            });
        }

        // Mirrors 2026_08_12_213933.
        if (! Schema::hasTable('promo_user_redemptions')) {
            Schema::create('promo_user_redemptions', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('user_id');
                $table->uuid('promo_code_id');
                $table->timestampTz('created_at')->useCurrent();

                $table->unique(['user_id', 'promo_code_id'], 'uq_promo_user_redemptions');
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
                $table->foreign('promo_code_id')->references('id')->on('promo_codes')->cascadeOnDelete();
            });
        }

        if (! Schema::hasTable('bookings')) {
            return;
        }

        if (! Schema::hasColumn('bookings', 'promo_code_id')) {
            Schema::table('bookings', function (Blueprint $table) {
                $table->uuid('promo_code_id')->nullable()->after('cancelled_by');
            });
        }

        // Mirrors 2026_07_28_000004.
        if (! Schema::hasColumn('bookings', 'promo_redeemed')) {
            Schema::table('bookings', function (Blueprint $table) {
                $table->boolean('promo_redeemed')->default(false)->after('promo_code_id');
            });
        }

        // Mirrors 2026_07_24_000001 (SQLite cannot ALTER TABLE ADD a foreign
        // key, so it never had one). The re-added column is all NULL, so there
        // are no orphans to check for.
        $driver = DB::getDriverName();
        if (($driver === 'mysql' || $driver === 'mariadb') && $this->mysqlForeignKeysOn('bookings', 'promo_code_id') === []) {
            DB::statement('ALTER TABLE `bookings` ADD CONSTRAINT '.self::FOREIGN_KEY
                .' FOREIGN KEY (`promo_code_id`) REFERENCES `promo_codes` (`id`) ON DELETE SET NULL');
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS '.self::FOREIGN_KEY);
            DB::statement('ALTER TABLE "bookings" ADD CONSTRAINT '.self::FOREIGN_KEY
                .' FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes" ("id") ON DELETE SET NULL');
        }
    }

    /**
     * Drop the foreign key from bookings.promo_code_id to promo_codes, if there
     * is one. On MySQL it is found by column rather than by name, so a key that
     * was created under another name is dropped too.
     */
    private function dropPromoCodeForeignKeys(): void
    {
        $driver = DB::getDriverName();

        if ($driver === 'mysql' || $driver === 'mariadb') {
            foreach ($this->mysqlForeignKeysOn('bookings', 'promo_code_id') as $name) {
                DB::statement('ALTER TABLE `bookings` DROP FOREIGN KEY `'.$name.'`');
            }
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS '.self::FOREIGN_KEY);
        }
    }

    /**
     * MySQL: names of the foreign keys that use this column.
     *
     * @return list<string>
     */
    private function mysqlForeignKeysOn(string $table, string $column): array
    {
        return array_values(array_unique(array_map(
            fn (object $row): string => (string) $row->name,
            DB::select(
                'SELECT constraint_name AS name FROM information_schema.key_column_usage '
                .'WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? '
                .'AND referenced_table_name IS NOT NULL',
                [$table, $column]
            ),
        )));
    }
};
