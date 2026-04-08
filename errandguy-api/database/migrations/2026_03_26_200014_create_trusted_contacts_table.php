<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('trusted_contacts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->string('name', 100);
            $table->string('phone', 20);
            $table->string('relationship', 30);
            $table->smallInteger('priority')->default(1);
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();

            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index('user_id', 'idx_trusted_contacts_user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trusted_contacts');
    }
};
