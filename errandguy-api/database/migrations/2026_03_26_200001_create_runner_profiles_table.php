<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('runner_profiles', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id')->unique();
            $table->string('verification_status', 15)->default('pending');
            $table->string('vehicle_type', 15)->nullable();
            $table->string('vehicle_plate', 20)->nullable();
            $table->text('vehicle_photo_url')->nullable();
            $table->boolean('is_online')->default(false);
            $table->decimal('current_lat', 10, 7)->nullable();
            $table->decimal('current_lng', 10, 7)->nullable();
            $table->timestampTz('last_location_at')->nullable();
            $table->decimal('acceptance_rate', 5, 2)->default(0.00);
            $table->decimal('completion_rate', 5, 2)->default(0.00);
            $table->integer('total_errands')->default(0);
            $table->decimal('total_earnings', 12, 2)->default(0.00);
            $table->jsonb('preferred_types')->default('[]');
            $table->decimal('working_area_lat', 10, 7)->nullable();
            $table->decimal('working_area_lng', 10, 7)->nullable();
            $table->integer('working_area_radius')->default(5000);
            $table->string('bank_name', 100)->nullable();
            $table->text('bank_account_number')->nullable();
            $table->string('ewallet_number', 20)->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampsTz();

            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index('user_id', 'idx_runner_profiles_user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('runner_profiles');
    }
};
