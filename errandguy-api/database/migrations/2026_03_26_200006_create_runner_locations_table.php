<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('runner_locations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('booking_id')->nullable();
            $table->uuid('runner_id');
            $table->decimal('lat', 10, 7);
            $table->decimal('lng', 10, 7);
            $table->decimal('heading', 5, 2)->nullable();
            $table->decimal('speed', 5, 2)->nullable();
            $table->decimal('accuracy', 5, 2)->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('booking_id')->references('id')->on('bookings');
            $table->foreign('runner_id')->references('id')->on('users');
            $table->index('booking_id', 'idx_runner_locations_booking_id');
            $table->index(['runner_id', 'created_at'], 'idx_runner_locations_runner_id_created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('runner_locations');
    }
};
