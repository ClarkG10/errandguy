<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('booking_status_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('booking_id');
            $table->string('status', 25);
            $table->uuid('changed_by')->nullable();
            $table->text('note')->nullable();
            $table->decimal('lat', 10, 7)->nullable();
            $table->decimal('lng', 10, 7)->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('booking_id')->references('id')->on('bookings')->cascadeOnDelete();
            $table->foreign('changed_by')->references('id')->on('users');
            $table->index('booking_id', 'idx_booking_status_logs_booking_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('booking_status_logs');
    }
};
