<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Fields for Xendit-linked / saved payment methods (Stage 2).
 *
 * A linked e-wallet (Maya/GrabPay/GCash) goes PENDING → ACTIVE once the
 * customer authorizes it; we key charges off the Xendit payment-method id.
 * A Xendit customer is created per user (required for reusable methods).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payment_methods', function (Blueprint $table) {
            // pending → awaiting the customer's linking authorization
            // active  → linked and chargeable
            // failed / expired → unusable
            $table->string('status', 15)->default('active')->after('type');
            // Xendit payment-method id (pm-xxx) used to charge the linked token.
            $table->string('gateway_ref')->nullable()->after('gateway_token');
            // Xendit channel code (GCASH / PAYMAYA / GRABPAY) for e-wallets.
            $table->string('channel_code', 20)->nullable()->after('card_brand');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->string('xendit_customer_id')->nullable()->after('wallet_balance');
        });
    }

    public function down(): void
    {
        Schema::table('payment_methods', function (Blueprint $table) {
            $table->dropColumn(['status', 'gateway_ref', 'channel_code']);
        });
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('xendit_customer_id');
        });
    }
};
