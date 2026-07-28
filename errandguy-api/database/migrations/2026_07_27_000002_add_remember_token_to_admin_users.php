<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The admin panel login has a "Remember me" checkbox. Laravel persists the
 * remember token to a `remember_token` column, which admin_users lacked —
 * ticking the box would 500 ("column remember_token does not exist"). Adds it.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('admin_users', 'remember_token')) {
            return;
        }

        Schema::table('admin_users', function (Blueprint $table) {
            $table->rememberToken();
        });
    }

    public function down(): void
    {
        if (! Schema::hasColumn('admin_users', 'remember_token')) {
            return;
        }

        Schema::table('admin_users', function (Blueprint $table) {
            $table->dropColumn('remember_token');
        });
    }
};
