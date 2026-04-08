<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('dispute_tickets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('booking_id');
            $table->uuid('reported_by');
            $table->string('category', 30);
            $table->text('description');
            $table->jsonb('evidence_urls')->default('[]');
            $table->string('status', 15)->default('open');
            $table->text('resolution')->nullable();
            $table->uuid('resolved_by')->nullable();
            $table->timestampTz('resolved_at')->nullable();
            $table->timestampsTz();

            $table->foreign('booking_id')->references('id')->on('bookings');
            $table->foreign('reported_by')->references('id')->on('users');
            $table->index('booking_id', 'idx_dispute_tickets_booking_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dispute_tickets');
    }
};
