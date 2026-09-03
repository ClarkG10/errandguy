<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When the CURRENT shift started.
 *
 * `is_online` was a bare boolean, so the moment a runner went online was never
 * recorded anywhere. That made two things impossible: telling a runner what
 * their shift actually amounted to when they clock off, and answering "how long
 * have I been online?" at all.
 *
 * Nullable, and null IS the meaning "not currently online" — so no backfill is
 * needed and a runner who is mid-shift at deploy time simply gets their shift
 * measured from their next toggle rather than a fabricated start.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('runner_profiles', function (Blueprint $table) {
            $table->timestamp('online_since')->nullable()->after('is_online');
        });
    }

    public function down(): void
    {
        Schema::table('runner_profiles', function (Blueprint $table) {
            $table->dropColumn('online_since');
        });
    }
};
