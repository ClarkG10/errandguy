<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('webhook_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('provider', 20)->default('xendit');
            // Stable provider event id (or a synthesized one). Uniqueness makes
            // a replayed delivery a true no-op even before the target row is
            // terminal, closing the window the old "already-terminal" guard left.
            $table->string('event_id', 191);
            $table->string('event_type', 60)->nullable();
            $table->jsonb('payload')->nullable();
            // received → processed (or failed). Only 'processed' short-circuits
            // a redelivery; a crashed 'received' event is safely re-run.
            $table->string('status', 12)->default('received');
            $table->timestampTz('processed_at')->nullable();
            $table->timestampsTz();

            $table->unique(['provider', 'event_id'], 'uq_webhook_provider_event');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('webhook_events');
    }
};
