<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Extra destinations for a multi-stop booking.
 *
 * The booking keeps its primary pickup + dropoff (single-stop bookings are
 * unchanged). A multi-stop booking adds one or more ordered stops AFTER the
 * primary dropoff, so the route is pickup → dropoff → stop 1 → stop 2 → …. Each
 * row is a destination with its own address, coordinates, optional contact, and
 * optional per-stop note. `completed_at` is reserved for a future per-stop
 * completion flow (not yet driven).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('booking_stops', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('booking_id');
            // 1-based order of this stop AFTER the primary dropoff.
            $table->unsignedTinyInteger('sequence');
            $table->string('address', 500);
            $table->decimal('lat', 10, 7);
            $table->decimal('lng', 10, 7);
            $table->string('contact_name', 100)->nullable();
            $table->string('contact_phone', 20)->nullable();
            $table->string('note', 300)->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->foreign('booking_id')->references('id')->on('bookings')->cascadeOnDelete();
            $table->index('booking_id', 'idx_booking_stops_booking_id');
            // One row per (booking, sequence) — guards against a double-write
            // producing two "stop 1"s.
            $table->unique(['booking_id', 'sequence'], 'uq_booking_stops_booking_sequence');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('booking_stops');
    }
};
