<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Adds an explicit lifecycle status to wallet_transactions.
 *
 * Without this column, payout requests submitted by runners had no way
 * to express "submitted but not yet sent" vs "completed" vs "failed".
 * Mobile UI was forced to guess via a 72-hour heuristic, which is brittle
 * (and silently misleads runners after the cutoff).
 *
 * Backfill rules:
 * - top_up / earning / payment / refund / bonus rows already represent
 *   completed money movements (the wallet balance was updated atomically
 *   in the same transaction that wrote them) → status = 'completed'.
 * - payout rows always represent a request that may still be in flight
 *   when an admin disburses → status = 'pending' (admin will mark them
 *   completed/failed via the new status endpoint).
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('wallet_transactions', function (Blueprint $table) {
            $table->string('status', 15)->default('completed')->after('description');
            $table->timestampTz('processed_at')->nullable()->after('status');
            $table->text('failure_reason')->nullable()->after('processed_at');
            $table->index(['type', 'status'], 'idx_wallet_transactions_type_status');
        });

        // Existing payouts may not yet be reconciled — mark pending so
        // operators can review and disburse them through the new flow.
        DB::table('wallet_transactions')->where('type', 'payout')->update(['status' => 'pending']);
    }

    public function down(): void
    {
        Schema::table('wallet_transactions', function (Blueprint $table) {
            $table->dropIndex('idx_wallet_transactions_type_status');
            $table->dropColumn(['status', 'processed_at', 'failure_reason']);
        });
    }
};
