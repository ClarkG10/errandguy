<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Set-password / forgot-password links for staff (the `admins` password
 * broker). Kept apart from the app users' password_reset_tokens, which is
 * keyed by email too — a staff member who also has an app account under the
 * same address would otherwise overwrite one link with the other.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('admin_password_reset_tokens')) {
            return;
        }

        Schema::create('admin_password_reset_tokens', function (Blueprint $table) {
            $table->string('email')->primary();
            $table->string('token');
            $table->timestamp('created_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_password_reset_tokens');
    }
};
