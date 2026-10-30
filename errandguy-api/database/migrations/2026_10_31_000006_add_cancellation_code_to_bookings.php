<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * bookings.cancellation_code: a machine-readable cause next to the
 * human-readable cancellation_reason, so the app can tell why an errand ended
 * without matching on wording. Set to 'payment_not_completed' when a GCash/Maya
 * errand is cancelled because its payment never arrived; null for every other
 * cancellation and for older rows (no backfill).
 *
 * Added only when missing, so a re-run after a partial failure is a no-op.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('bookings') && ! Schema::hasColumn('bookings', 'cancellation_code')) {
            Schema::table('bookings', function (Blueprint $table) {
                $table->string('cancellation_code', 40)->nullable()->after('cancellation_reason');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('bookings') && Schema::hasColumn('bookings', 'cancellation_code')) {
            Schema::table('bookings', function (Blueprint $table) {
                $table->dropColumn('cancellation_code');
            });
        }
    }
};
