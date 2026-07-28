<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Distinguishes HOW a payment was refunded so a `refunded` record stops
 * ambiguously meaning either a real gateway reversal or in-app wallet credit
 * (payment review P0-1). 'gateway' = reversed to source via Xendit;
 * 'wallet' = credited to the customer's ErrandGuy wallet. Null until refunded.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('payments', 'refunded_to')) {
            return;
        }

        Schema::table('payments', function (Blueprint $table) {
            $table->string('refunded_to', 10)->nullable()->after('refund_amount');
        });
    }

    public function down(): void
    {
        if (! Schema::hasColumn('payments', 'refunded_to')) {
            return;
        }

        Schema::table('payments', function (Blueprint $table) {
            $table->dropColumn('refunded_to');
        });
    }
};
