<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which phone a push registration belongs to (the app's per-install
 * device_id, the same id its sign-in token is named by). Lets signing out of
 * one phone drop that phone's registration even when the app doesn't send its
 * push token, and lets a password change keep only the current phone's.
 *
 * Nullable: rows registered before this column are simply unlinked. Checks
 * first, so a re-run is a no-op.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('device_tokens') || Schema::hasColumn('device_tokens', 'device_id')) {
            return;
        }

        Schema::table('device_tokens', function (Blueprint $table) {
            $table->string('device_id', 100)->nullable()->after('platform');
            $table->index(['user_id', 'device_id'], 'idx_device_tokens_user_device');
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('device_tokens') || ! Schema::hasColumn('device_tokens', 'device_id')) {
            return;
        }

        Schema::table('device_tokens', function (Blueprint $table) {
            $table->dropIndex('idx_device_tokens_user_device');
        });
        Schema::table('device_tokens', function (Blueprint $table) {
            $table->dropColumn('device_id');
        });
    }
};
