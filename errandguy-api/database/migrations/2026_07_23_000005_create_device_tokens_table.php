<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Per-device push tokens.
 *
 * Push delivery used a single `users.fcm_token` column, overwritten on every
 * device registration — so signing in on a second device silently stopped the
 * first from ever receiving a push. This one-to-many table lets a user keep a
 * live token per device; sends fan out to all of them and prune the dead ones.
 *
 * `users.fcm_token` is intentionally kept (still written on registration) as a
 * backward-compatible fallback until every client has re-registered.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('device_tokens', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('token', 255);
            $table->string('platform', 15)->nullable();
            $table->timestampTz('last_used_at')->nullable();
            $table->timestampsTz();

            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            // A physical device's token belongs to at most one user (a device
            // handoff / re-login just re-points the row to the new user).
            $table->unique('token', 'uq_device_tokens_token');
            $table->index('user_id', 'idx_device_tokens_user_id');
        });

        // Backfill existing single-column tokens so no device loses push on
        // deploy. insertOrIgnore skips any duplicate token defensively.
        DB::table('users')
            ->whereNotNull('fcm_token')
            ->select('id', 'fcm_token')
            ->orderBy('id')
            ->chunk(500, function ($users) {
                $now = now();
                $rows = $users->map(fn ($u) => [
                    'id' => (string) Str::uuid(),
                    'user_id' => $u->id,
                    'token' => $u->fcm_token,
                    'last_used_at' => $now,
                    'created_at' => $now,
                    'updated_at' => $now,
                ])->all();
                DB::table('device_tokens')->insertOrIgnore($rows);
            });
    }

    public function down(): void
    {
        Schema::dropIfExists('device_tokens');
    }
};
