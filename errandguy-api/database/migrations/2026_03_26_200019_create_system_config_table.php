<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('system_config', function (Blueprint $table) {
            $table->string('key', 50)->primary();
            $table->text('value');
            $table->text('description')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestampTz('updated_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('system_config');
    }
};
