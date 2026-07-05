<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            // How the customer settles this booking:
            //   cash | wallet | gcash | maya | card
            $table->string('payment_method', 15)->nullable()->after('total_amount');
            // Settlement state, independent of the errand lifecycle `status`:
            //   unpaid | pending | paid | refunded | failed
            //  - cash  → stays `unpaid` until the runner collects, then `paid`
            //  - wallet→ `paid` immediately (balance deducted at booking time)
            //  - online→ `pending` until the Xendit webhook confirms → `paid`
            $table->string('payment_status', 15)->default('unpaid')->after('payment_method');
            $table->index('payment_status', 'idx_bookings_payment_status');
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropIndex('idx_bookings_payment_status');
            $table->dropColumn(['payment_method', 'payment_status']);
        });
    }
};
