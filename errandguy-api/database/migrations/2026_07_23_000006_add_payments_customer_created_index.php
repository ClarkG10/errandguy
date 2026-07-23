<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Composite index for the customer payment-history listing.
 *
 * PaymentHistoryController filters by customer_id then orders by created_at,
 * but `payments` only had a single-column idx_payments_customer_id — so
 * Postgres seeks the customer's rows then sorts them on every page. This
 * mirrors the (customer_id, status, created_at) / (user_id, created_at)
 * composites already added for bookings, notifications, and wallet_transactions.
 * Additive; a distinct name so it coexists with idx_payments_customer_id.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->index(['customer_id', 'created_at'], 'idx_payments_customer_created');
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropIndex('idx_payments_customer_created');
        });
    }
};
