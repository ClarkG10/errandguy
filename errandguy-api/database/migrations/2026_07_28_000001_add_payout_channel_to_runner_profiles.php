<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Xendit Payouts needs a channel_code (e.g. PH_GCASH, PH_PAYMAYA, or a bank
 * code) alongside the account number. Runner profiles previously stored only a
 * free-text bank name + e-wallet number, which isn't enough to auto-disburse.
 * This adds an optional channel code the runner (or admin) can set; the admin
 * "Send via Xendit" action can also pick/override it at send time.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('runner_profiles', 'payout_channel_code')) {
            return;
        }

        Schema::table('runner_profiles', function (Blueprint $table) {
            $table->string('payout_channel_code', 30)->nullable()->after('ewallet_number');
        });
    }

    public function down(): void
    {
        if (! Schema::hasColumn('runner_profiles', 'payout_channel_code')) {
            return;
        }

        Schema::table('runner_profiles', function (Blueprint $table) {
            $table->dropColumn('payout_channel_code');
        });
    }
};
