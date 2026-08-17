<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The admin verification queue (RunnerVerificationController::pending) runs an
 * UNCACHED, paginated, created_at-sorted query filtering ONLY on
 * verification_status = 'pending'. The only index containing verification_status
 * is the geo composite (is_online, verification_status, current_lat), where it
 * is the 2nd column — unusable for a query that does not also constrain
 * is_online. So this endpoint full-scans + filesorts an ever-growing set (five
 * controllers auto-create 'pending' stub profiles on first touch, so abandoned
 * onboarding accumulates). A leading (verification_status, created_at) composite
 * serves the WHERE + ORDER BY in one shot. verification_status is written only on
 * approve/reject, so the index is cheap to maintain. Additive; distinct name.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('runner_profiles', function (Blueprint $table) {
            $table->index(['verification_status', 'created_at'], 'idx_runner_profiles_verif_created');
        });
    }

    public function down(): void
    {
        Schema::table('runner_profiles', function (Blueprint $table) {
            $table->dropIndex('idx_runner_profiles_verif_created');
        });
    }
};
