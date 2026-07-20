<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Append-only audit log of every payment status change. This is the seed
     * of the wider financial audit trail: who moved a payment from where to
     * where, when, and why. Rows are never updated or deleted.
     */
    public function up(): void
    {
        Schema::create('payment_status_transitions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('payment_id');
            $table->string('from_status', 15)->nullable();
            $table->string('to_status', 15);
            // 'system' | 'webhook' | a user/admin uuid — who triggered the move.
            $table->string('actor', 60)->nullable();
            $table->string('reason', 191)->nullable();
            $table->jsonb('meta')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('payment_id')->references('id')->on('payments')->cascadeOnDelete();
            $table->index('payment_id', 'idx_pst_payment_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_status_transitions');
    }
};
