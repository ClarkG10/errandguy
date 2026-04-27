<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Adds runner-side SOS support.
 *
 * - Makes `runner_id` nullable so a customer can SOS while still searching
 *   for a runner.
 * - Adds `triggered_by` (FK users) + `triggered_by_role` so we know which
 *   party pulled the alarm without inferring it from the booking state.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sos_alerts', function (Blueprint $table) {
            $table->uuid('triggered_by')->nullable()->after('runner_id');
            $table->string('triggered_by_role', 15)->nullable()->after('triggered_by');
        });

        // Loosen runner_id NOT NULL via raw SQL (Postgres + supabase).
        DB::statement('ALTER TABLE sos_alerts ALTER COLUMN runner_id DROP NOT NULL');

        // Backfill existing rows (assume customer-triggered, since that was
        // the only path before this migration).
        DB::statement("UPDATE sos_alerts SET triggered_by = customer_id, triggered_by_role = 'customer' WHERE triggered_by IS NULL");

        Schema::table('sos_alerts', function (Blueprint $table) {
            $table->foreign('triggered_by')->references('id')->on('users');
            $table->index('triggered_by', 'idx_sos_alerts_triggered_by');
        });
    }

    public function down(): void
    {
        Schema::table('sos_alerts', function (Blueprint $table) {
            $table->dropForeign(['triggered_by']);
            $table->dropIndex('idx_sos_alerts_triggered_by');
            $table->dropColumn(['triggered_by', 'triggered_by_role']);
        });

        DB::statement('ALTER TABLE sos_alerts ALTER COLUMN runner_id SET NOT NULL');
    }
};
