<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notifications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('title', 100);
            $table->text('body');
            $table->string('type', 20);
            $table->jsonb('data')->nullable();
            $table->boolean('is_read')->default(false);
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index(['user_id', 'created_at'], 'idx_notifications_user_id_created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notifications');
    }
};
