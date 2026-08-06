<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tip a runner receives on a completed errand. Denormalised onto the booking for
 * display + a one-tip-per-booking guard; the actual money movement lives in two
 * paired `tip` wallet_transactions (customer debit + runner credit).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->decimal('tip_amount', 10, 2)->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn('tip_amount');
        });
    }
};
