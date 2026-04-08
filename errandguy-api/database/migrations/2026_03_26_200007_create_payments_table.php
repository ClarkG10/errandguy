<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('booking_id');
            $table->uuid('customer_id');
            $table->decimal('amount', 10, 2);
            $table->string('currency', 5)->default('PHP');
            $table->string('method', 15);
            $table->string('status', 15)->default('pending');
            $table->string('gateway_tx_id', 100)->nullable();
            $table->jsonb('gateway_response')->nullable();
            $table->timestampTz('paid_at')->nullable();
            $table->decimal('refund_amount', 10, 2)->nullable();
            $table->timestampTz('refunded_at')->nullable();
            $table->timestampsTz();

            $table->foreign('booking_id')->references('id')->on('bookings');
            $table->foreign('customer_id')->references('id')->on('users');
            $table->index('booking_id', 'idx_payments_booking_id');
            $table->index('customer_id', 'idx_payments_customer_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payments');
    }
};
