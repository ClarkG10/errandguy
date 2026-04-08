<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wallet_transactions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('type', 15);
            $table->decimal('amount', 10, 2);
            $table->decimal('balance_after', 12, 2);
            $table->uuid('reference_id')->nullable();
            $table->text('description')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('user_id')->references('id')->on('users');
            $table->index(['user_id', 'created_at'], 'idx_wallet_transactions_user_id_created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wallet_transactions');
    }
};
