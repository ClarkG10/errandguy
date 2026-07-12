<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('support_messages', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('ticket_id');
            $table->uuid('sender_id')->nullable();
            $table->string('sender_type'); // user|agent|system
            $table->text('content');
            $table->text('image_url')->nullable();
            $table->timestampTz('read_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('ticket_id')->references('id')->on('support_tickets')->cascadeOnDelete();
            $table->foreign('sender_id')->references('id')->on('users')->nullOnDelete();
            $table->index(['ticket_id', 'created_at'], 'idx_support_messages_ticket_created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('support_messages');
    }
};
