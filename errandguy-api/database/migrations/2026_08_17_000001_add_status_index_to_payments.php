<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * `payments.status` is a hot filter with no index: the reconciliation sweep
 * (pending/processing), every Filament payment-list tab, and the payment stats
 * widgets all filter by status, most of them combined with a created_at/paid_at
 * range. A composite (status, created_at) serves both the status-only filters
 * (leftmost prefix) and the status + time-range ones. Additive; distinct name.
 *
 * (Audit note: gateway_tx_id is already covered by the unique index
 * uq_payments_gateway_tx, and bookings.cancelled_by is never filtered, so
 * neither needs an index — only this one was a real gap.)
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->index(['status', 'created_at'], 'idx_payments_status_created');
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropIndex('idx_payments_status_created');
        });
    }
};
