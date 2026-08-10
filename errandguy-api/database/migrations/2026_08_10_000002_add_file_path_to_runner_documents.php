<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * SEC-1: move KYC documents off the world-readable public disk onto a PRIVATE
 * disk served only through an authenticated route.
 *
 * New uploads store their PRIVATE-disk relative path in `file_path` and leave
 * `file_url` null. Legacy rows keep their public `file_url` (served via the same
 * route's fallback) until a one-off data migration moves them — so this schema
 * change is backward-compatible and non-destructive.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('runner_documents', function (Blueprint $table) {
            $table->string('file_path')->nullable()->after('document_type');
            // Legacy public URL — now optional (new rows use file_path instead).
            $table->text('file_url')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('runner_documents', function (Blueprint $table) {
            $table->dropColumn('file_path');
            // Note: not restoring file_url NOT NULL — legacy data may now hold
            // rows with a null file_url (file_path-only), so leaving it nullable
            // on rollback avoids a destructive constraint failure.
        });
    }
};
