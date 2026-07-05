<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Store the payment-gateway reference + hosted-checkout URL on a wallet
 * transaction so a PENDING top-up can be reconciled by the Xendit webhook
 * (invoice.paid) and the client can be redirected to complete payment.
 *
 * Previously top-ups credited the balance instantly with no real charge;
 * the balance is now only credited once `invoice.paid` fires for the
 * matching `gateway_ref` / external_id.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('wallet_transactions', function (Blueprint $table) {
            $table->string('gateway_ref', 100)->nullable()->after('reference_id');
            $table->text('checkout_url')->nullable()->after('gateway_ref');
            $table->index('gateway_ref', 'idx_wallet_transactions_gateway_ref');
        });
    }

    public function down(): void
    {
        Schema::table('wallet_transactions', function (Blueprint $table) {
            $table->dropIndex('idx_wallet_transactions_gateway_ref');
            $table->dropColumn(['gateway_ref', 'checkout_url']);
        });
    }
};
