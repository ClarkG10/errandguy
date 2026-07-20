<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('idempotency_keys', function (Blueprint $table) {
            $table->uuid('id')->primary();
            // Client-supplied Idempotency-Key header. Scoped per user so one
            // user's key can never collide with (or replay) another's.
            $table->uuid('user_id')->nullable();
            $table->string('idem_key', 191);
            $table->string('method', 10);
            $table->string('path', 191);
            // sha256 hex of the normalized request so a reused key with a
            // DIFFERENT body is rejected (422) instead of silently replayed.
            $table->string('request_hash', 64);
            // in_progress → completed. A row stuck in_progress simply expires.
            $table->string('status', 12)->default('in_progress');
            $table->unsignedSmallInteger('response_code')->nullable();
            $table->jsonb('response_body')->nullable();
            $table->timestampTz('locked_at')->nullable();
            $table->timestampTz('expires_at')->nullable();
            $table->timestampsTz();

            $table->unique(['user_id', 'idem_key'], 'uq_idem_user_key');
            $table->index('expires_at', 'idx_idem_expires');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('idempotency_keys');
    }
};
