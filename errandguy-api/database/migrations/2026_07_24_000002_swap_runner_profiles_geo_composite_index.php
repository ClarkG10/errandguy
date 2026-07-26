<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Swap the runner-matching geo indexes for a single covering composite.
 *
 * MatchingService::getEligibleRunners / LocationService::getNearbyRunners filter
 *   is_online = true
 *   AND verification_status = 'approved'
 *   AND current_lat BETWEEN ? AND ?
 *   AND current_lng BETWEEN ? AND ?
 * Every geo query filters lat AND lng TOGETHER, so the standalone
 * idx_runner_profiles_current_lat is never usable in isolation — it only
 * write-amplifies every ~5s runner location ping. And the
 * (is_online, verification_status) index can't range on latitude within the
 * online/approved slice.
 *
 * The composite (is_online, verification_status, current_lat):
 *   - subsumes the old (is_online, verification_status) as a left prefix, and
 *   - gives the planner a latitude range scan WITHIN the selective
 *     online+approved slice, replacing the old BitmapAnd of two indexes.
 * So both old indexes are dropped.
 *
 * IMPORTANT: `runner_profiles` is a SHARED table also read by the NestJS port.
 * Index ownership lives with these Laravel migrations, so the change is authored
 * here and MIRRORED in errandguy-nest/prisma/schema.prisma (@@index). Do NOT
 * hand-apply SQL only on the Nest side, or a `prisma migrate` reset would
 * desync from Laravel's migration state and recreate the dropped indexes.
 *
 * See audit finding P21.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('runner_profiles', function (Blueprint $table) {
            $table->index(
                ['is_online', 'verification_status', 'current_lat'],
                'idx_runner_profiles_online_status_lat'
            );
            $table->dropIndex('idx_runner_profiles_online_status');
            $table->dropIndex('idx_runner_profiles_current_lat');
        });
    }

    public function down(): void
    {
        Schema::table('runner_profiles', function (Blueprint $table) {
            $table->index(['is_online', 'verification_status'], 'idx_runner_profiles_online_status');
            $table->index('current_lat', 'idx_runner_profiles_current_lat');
            $table->dropIndex('idx_runner_profiles_online_status_lat');
        });
    }
};
