<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('referrals', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('referrer_id');
            $table->uuid('referee_id');
            // pending | qualified | rewarded
            $table->string('status', 15)->default('pending');
            $table->decimal('reward_amount', 10, 2)->nullable();
            $table->timestampTz('qualified_at')->nullable();
            $table->timestampTz('rewarded_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('referrer_id')
                ->references('id')->on('users')
                ->cascadeOnDelete();
            $table->foreign('referee_id')
                ->references('id')->on('users')
                ->cascadeOnDelete();

            // A user can only ever be referred once.
            $table->unique('referee_id', 'uq_referrals_referee_id');
            $table->index('referrer_id', 'idx_referrals_referrer_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('referrals');
    }
};
