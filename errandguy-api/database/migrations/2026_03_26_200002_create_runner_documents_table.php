<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('runner_documents', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('runner_id');
            $table->string('document_type', 25);
            $table->text('file_url');
            $table->string('status', 15)->default('pending');
            $table->text('rejection_reason')->nullable();
            $table->uuid('reviewed_by')->nullable();
            $table->timestampTz('reviewed_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('runner_id')->references('id')->on('runner_profiles')->cascadeOnDelete();
            $table->index('runner_id', 'idx_runner_documents_runner_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('runner_documents');
    }
};
