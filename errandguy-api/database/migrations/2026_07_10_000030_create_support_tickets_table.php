<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('support_tickets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->uuid('booking_id')->nullable();
            $table->string('subject');
            $table->string('category');
            $table->string('status')->default('open'); // open|pending|resolved|closed
            $table->timestampTz('last_message_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('booking_id')->references('id')->on('bookings')->nullOnDelete();
            $table->index(['user_id', 'status'], 'idx_support_tickets_user_status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('support_tickets');
    }
};
