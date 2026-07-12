<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Nullable so existing rows can be backfilled safely; the app
            // generates a code on create (User::booted) for new users.
            $table->string('referral_code', 12)->nullable()->unique()->after('last_active_at');
            $table->uuid('referred_by')->nullable()->after('referral_code');

            $table->foreign('referred_by')
                ->references('id')->on('users')
                ->nullOnDelete();

            $table->index('referred_by', 'idx_users_referred_by');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['referred_by']);
            $table->dropIndex('idx_users_referred_by');
            $table->dropUnique('users_referral_code_unique');
            $table->dropColumn(['referral_code', 'referred_by']);
        });
    }
};
