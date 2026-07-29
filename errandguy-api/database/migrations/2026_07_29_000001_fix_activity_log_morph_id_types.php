<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The spatie activity-log table was created with the default `nullableMorphs`,
 * which makes subject_id / causer_id BIGINT. But every model the admin panel
 * logs against (AdminUser causer, and Booking/Payment/SOSAlert/etc. subjects)
 * uses a UUID string key — so AdminActivity::log() crashed with
 * "invalid input syntax for type bigint". Widen both morph id columns to string.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('activity_log')) {
            return;
        }

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE activity_log ALTER COLUMN subject_id TYPE varchar(255) USING subject_id::varchar');
            DB::statement('ALTER TABLE activity_log ALTER COLUMN causer_id TYPE varchar(255) USING causer_id::varchar');
        } else {
            Schema::table('activity_log', function ($table): void {
                $table->string('subject_id')->nullable()->change();
                $table->string('causer_id')->nullable()->change();
            });
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('activity_log')) {
            return;
        }

        if (DB::getDriverName() === 'pgsql') {
            // Non-numeric (UUID) ids can't become bigint, so null those out.
            DB::statement("ALTER TABLE activity_log ALTER COLUMN subject_id TYPE bigint USING (CASE WHEN subject_id ~ '^\\d+$' THEN subject_id::bigint ELSE NULL END)");
            DB::statement("ALTER TABLE activity_log ALTER COLUMN causer_id TYPE bigint USING (CASE WHEN causer_id ~ '^\\d+$' THEN causer_id::bigint ELSE NULL END)");
        }
    }
};
