<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_methods', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('type', 15);
            $table->string('label', 50);
            $table->text('gateway_token')->nullable();
            $table->boolean('is_default')->default(false);
            $table->string('last_four', 4)->nullable();
            $table->string('card_brand', 20)->nullable();
            $table->date('expires_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index('user_id', 'idx_payment_methods_user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_methods');
    }
};
