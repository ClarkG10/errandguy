<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The runner acceptance rate is gone. It was lowered on every decline, never
 * raised by an accept, so it only ever measured how often a runner said no —
 * and matching used it to rank runners. Runners are now offered errands by
 * distance alone.
 *
 * Any index on the column is dropped first (SQLite won't drop an indexed
 * column); every step checks first, so a re-run is a no-op.
 */
return new class extends Migration
{
    private const TABLE = 'runner_profiles';

    private const COLUMN = 'acceptance_rate';

    public function up(): void
    {
        if (! Schema::hasTable(self::TABLE) || ! Schema::hasColumn(self::TABLE, self::COLUMN)) {
            return;
        }

        foreach (Schema::getIndexes(self::TABLE) as $index) {
            if (! $index['primary'] && in_array(self::COLUMN, $index['columns'], true)) {
                Schema::table(self::TABLE, function (Blueprint $table) use ($index) {
                    $table->dropIndex($index['name']);
                });
            }
        }

        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->dropColumn(self::COLUMN);
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable(self::TABLE) || Schema::hasColumn(self::TABLE, self::COLUMN)) {
            return;
        }

        // Mirrors 2026_03_26_200001.
        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->decimal(self::COLUMN, 5, 2)->default(0.00);
        });
    }
};
