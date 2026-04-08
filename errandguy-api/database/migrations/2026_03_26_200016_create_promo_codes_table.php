<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('promo_codes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code', 30)->unique();
            $table->text('description')->nullable();
            $table->string('discount_type', 10);
            $table->decimal('discount_value', 8, 2);
            $table->decimal('max_discount', 8, 2)->nullable();
            $table->decimal('min_order', 8, 2)->default(0.00);
            $table->integer('usage_limit')->nullable();
            $table->integer('per_user_limit')->default(1);
            $table->integer('used_count')->default(0);
            $table->timestampTz('valid_from');
            $table->timestampTz('valid_until');
            $table->boolean('is_active')->default(true);
            $table->timestampTz('created_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('promo_codes');
    }
};
