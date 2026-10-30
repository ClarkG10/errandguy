<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Two-step sign-in for staff (Filament multi-factor authentication), required
 * for every staff role:
 *
 *   - app_authentication_secret: the authenticator-app secret (stored
 *     encrypted by the model);
 *   - app_authentication_recovery_codes: hashed one-time recovery codes
 *     (encrypted);
 *   - has_email_authentication: signs in with a code emailed to the staff
 *     member instead.
 *
 * Existing staff have neither, so they set one up the next time they sign in.
 * Each column is added only when missing, so a re-run is a no-op.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('admin_users')) {
            return;
        }

        if (! Schema::hasColumn('admin_users', 'app_authentication_secret')) {
            Schema::table('admin_users', function (Blueprint $table) {
                $table->text('app_authentication_secret')->nullable();
            });
        }

        if (! Schema::hasColumn('admin_users', 'app_authentication_recovery_codes')) {
            Schema::table('admin_users', function (Blueprint $table) {
                $table->text('app_authentication_recovery_codes')->nullable();
            });
        }

        if (! Schema::hasColumn('admin_users', 'has_email_authentication')) {
            Schema::table('admin_users', function (Blueprint $table) {
                $table->boolean('has_email_authentication')->default(false);
            });
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('admin_users')) {
            return;
        }

        foreach (['app_authentication_secret', 'app_authentication_recovery_codes', 'has_email_authentication'] as $column) {
            if (Schema::hasColumn('admin_users', $column)) {
                Schema::table('admin_users', function (Blueprint $table) use ($column) {
                    $table->dropColumn($column);
                });
            }
        }
    }
};
