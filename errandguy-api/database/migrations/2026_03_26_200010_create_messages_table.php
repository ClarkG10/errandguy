<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('messages', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('booking_id');
            $table->uuid('sender_id');
            $table->text('content')->nullable();
            $table->text('image_url')->nullable();
            $table->boolean('is_system')->default(false);
            $table->timestampTz('read_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('booking_id')->references('id')->on('bookings')->cascadeOnDelete();
            $table->foreign('sender_id')->references('id')->on('users');
            $table->index(['booking_id', 'created_at'], 'idx_messages_booking_id_created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('messages');
    }
};
