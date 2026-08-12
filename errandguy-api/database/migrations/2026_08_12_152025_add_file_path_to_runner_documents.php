<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * KYC hardening: runner identity documents now live on the PRIVATE 'kyc' disk
 * (streamed via authorized routes), not the web-served public disk. New rows
 * store the disk-relative path in file_path and have no public file_url, so
 * file_url must accept null. Existing legacy rows keep their public file_url
 * until their files are migrated off the public disk (ops step).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('runner_documents', function (Blueprint $table) {
            $table->text('file_path')->nullable()->after('document_type');
        });

        Schema::table('runner_documents', function (Blueprint $table) {
            $table->text('file_url')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('runner_documents', function (Blueprint $table) {
            $table->dropColumn('file_path');
        });
        // file_url intentionally left nullable — private rows legitimately null.
    }
};
