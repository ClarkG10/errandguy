<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('runner_locations', function (Blueprint $table) {
            // Standalone created_at index so the daily retention prune
            // (DELETE WHERE created_at < now-24h) uses a range scan instead of a
            // full-table scan. The existing (runner_id, created_at) composite
            // can't serve this query — it doesn't filter on the leading
            // runner_id column. (PERF-BE-4)
            //
            // On MySQL 8 adding a secondary index is online (ALGORITHM=INPLACE,
            // LOCK=NONE by default), so this does not block reads/writes on the
            // tracking-read hot table during deploy.
            $table->index('created_at', 'idx_runner_locations_created');
        });
    }

    public function down(): void
    {
        Schema::table('runner_locations', function (Blueprint $table) {
            $table->dropIndex('idx_runner_locations_created');
        });
    }
};
