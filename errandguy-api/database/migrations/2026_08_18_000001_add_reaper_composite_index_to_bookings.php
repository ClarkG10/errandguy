<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The stranded-booking reaper (errandguy:reap-stranded-bookings, every 5 min)
 * runs an orphan-refund pass:
 *   WHERE status='cancelled' AND payment_status='paid'
 *     AND (cancelled_at IS NULL OR cancelled_at < now-2m)
 *   ORDER BY cancelled_at LIMIT N
 * bookings only had single-column idx_bookings_status / idx_bookings_payment_status,
 * so MySQL seeks one, then scans the whole (and ever-growing) 'cancelled' bucket
 * filtering payment_status + filesorting by cancelled_at — 288 scans/day whose cost
 * grows for the life of the platform to find a near-empty orphan set.
 *
 * This composite lets it seek straight to the tiny (cancelled, paid) intersection
 * and read it in cancelled_at order with no filesort. Additive + conservatively
 * named so it coexists with the existing single-column indexes.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->index(['status', 'payment_status', 'cancelled_at'], 'idx_bookings_status_paystatus_cancelled');
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropIndex('idx_bookings_status_paystatus_cancelled');
        });
    }
};
