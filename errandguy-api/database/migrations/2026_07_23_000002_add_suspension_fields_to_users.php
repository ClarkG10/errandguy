<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the columns admin suspension actually needs.
 *
 * The moderation endpoints wrote `is_active` / `suspended_reason` — neither of
 * which existed — so mass-assignment silently discarded them and suspensions
 * were a no-op (see SYSTEM_AUDIT H4). Enforcement already keys on `users.status`
 * (EnsureUserActive / LoginController), so suspend now writes status='suspended';
 * these columns just record WHY and WHEN for the admin UI / audit.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('suspended_reason', 500)->nullable()->after('status');
            $table->timestampTz('suspended_at')->nullable()->after('suspended_reason');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['suspended_reason', 'suspended_at']);
        });
    }
};
