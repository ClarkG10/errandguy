<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('phone', 20)->unique()->nullable();
            $table->string('email', 255)->unique()->nullable();
            $table->string('password_hash', 255);
            $table->string('full_name', 100);
            $table->text('avatar_url')->nullable();
            $table->string('role', 10);
            $table->string('status', 15)->default('active');
            $table->boolean('email_verified')->default(false);
            $table->boolean('phone_verified')->default(false);
            $table->decimal('default_lat', 10, 7)->nullable();
            $table->decimal('default_lng', 10, 7)->nullable();
            $table->text('fcm_token')->nullable();
            $table->decimal('wallet_balance', 12, 2)->default(0.00);
            $table->decimal('avg_rating', 3, 2)->default(0.00);
            $table->integer('total_ratings')->default(0);
            $table->timestampTz('last_active_at')->nullable();
            $table->softDeletesTz();
            $table->timestampsTz();

            $table->index('phone', 'idx_users_phone');
            $table->index('email', 'idx_users_email');
            $table->index(['role', 'status'], 'idx_users_role_status');
        });

        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->string('email')->primary();
            $table->string('token');
            $table->timestamp('created_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('password_reset_tokens');
        Schema::dropIfExists('users');
    }
};
