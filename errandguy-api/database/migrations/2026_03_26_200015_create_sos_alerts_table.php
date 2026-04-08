<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sos_alerts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('booking_id');
            $table->uuid('customer_id');
            $table->uuid('runner_id');
            $table->timestampTz('triggered_at');
            $table->decimal('customer_lat', 10, 7)->nullable();
            $table->decimal('customer_lng', 10, 7)->nullable();
            $table->decimal('runner_lat', 10, 7)->nullable();
            $table->decimal('runner_lng', 10, 7)->nullable();
            $table->jsonb('contacts_notified')->default('[]');
            $table->string('live_link_token', 64)->nullable();
            $table->timestampTz('live_link_expires_at')->nullable();
            $table->timestampTz('resolved_at')->nullable();
            $table->text('resolution_note')->nullable();
            $table->string('status', 15)->default('active');
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('booking_id')->references('id')->on('bookings');
            $table->foreign('customer_id')->references('id')->on('users');
            $table->foreign('runner_id')->references('id')->on('users');
            $table->index('booking_id', 'idx_sos_alerts_booking_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sos_alerts');
    }
};
