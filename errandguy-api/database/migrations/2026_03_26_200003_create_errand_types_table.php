<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('errand_types', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('slug', 30)->unique();
            $table->string('name', 50);
            $table->text('description');
            $table->string('icon_name', 30);
            $table->decimal('base_fee', 8, 2);
            $table->decimal('per_km_walk', 6, 2);
            $table->decimal('per_km_bicycle', 6, 2);
            $table->decimal('per_km_motorcycle', 6, 2);
            $table->decimal('per_km_car', 6, 2);
            $table->decimal('surcharge', 6, 2)->default(0.00);
            $table->decimal('min_negotiate_fee', 8, 2);
            $table->boolean('is_active')->default(true);
            $table->integer('sort_order')->default(0);
            $table->timestampTz('created_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('errand_types');
    }
};
