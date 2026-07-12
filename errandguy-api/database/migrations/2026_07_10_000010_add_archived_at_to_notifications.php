<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->timestampTz('archived_at')->nullable()->after('is_read');
            $table->index(['user_id', 'archived_at'], 'idx_notifications_user_id_archived');
        });
    }

    public function down(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->dropIndex('idx_notifications_user_id_archived');
            $table->dropColumn('archived_at');
        });
    }
};
