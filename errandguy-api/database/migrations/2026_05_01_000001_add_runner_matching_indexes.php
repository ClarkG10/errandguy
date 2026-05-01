<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Composite indexes for the runner-matching hot path.
 *
 * `LocationService::getNearbyRunners` filters by `is_online=true AND
 * verification_status='approved'` then narrows by a lat/lng bounding
 * box. Without an index covering the boolean+enum prefix, Postgres
 * was scanning every runner profile row on every booking dispatch.
 *
 * The two-column composite (is_online, verification_status) lets the
 * planner do a sub-millisecond seek to the small "online + approved"
 * slice; the bounding-box ranges then become an in-memory filter on a
 * cardinality that's usually under a few hundred rows.
 *
 * A separate single-column index on `current_lat` is added so the
 * planner can pick a range scan when the online slice itself is huge
 * (peak hours): Postgres' bitmap-and combines both indexes on the fly.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('runner_profiles', function (Blueprint $table) {
            $table->index(
                ['is_online', 'verification_status'],
                'idx_runner_profiles_online_status'
            );
            $table->index('current_lat', 'idx_runner_profiles_current_lat');
        });
    }

    public function down(): void
    {
        Schema::table('runner_profiles', function (Blueprint $table) {
            $table->dropIndex('idx_runner_profiles_online_status');
            $table->dropIndex('idx_runner_profiles_current_lat');
        });
    }
};
