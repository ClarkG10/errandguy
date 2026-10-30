<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which staff member moved money by hand: set on a wallet adjustment and on a
 * "Pay a runner" payout, null on everything the app or a customer/runner does.
 * WalletService adds these up per staff member per Manila day to enforce the
 * admin_adjustment_daily_cap setting.
 *
 * Nullable with no backfill — older rows predate the limit. Checks first, so a
 * re-run is a no-op.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('wallet_transactions') || Schema::hasColumn('wallet_transactions', 'initiated_by_staff_id')) {
            return;
        }

        Schema::table('wallet_transactions', function (Blueprint $table) {
            $table->uuid('initiated_by_staff_id')->nullable();
            $table->index(['initiated_by_staff_id', 'created_at'], 'idx_wallet_transactions_staff_created');
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('wallet_transactions') || ! Schema::hasColumn('wallet_transactions', 'initiated_by_staff_id')) {
            return;
        }

        Schema::table('wallet_transactions', function (Blueprint $table) {
            $table->dropIndex('idx_wallet_transactions_staff_created');
        });
        Schema::table('wallet_transactions', function (Blueprint $table) {
            $table->dropColumn('initiated_by_staff_id');
        });
    }
};
