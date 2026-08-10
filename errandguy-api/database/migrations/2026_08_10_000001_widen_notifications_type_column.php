<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Widen notifications.type from VARCHAR(20) to VARCHAR(40).
 *
 * The column was created at 20 chars, but the app emits the notification type
 * 'shopping_items_updated' (22 chars) when a runner edits a shopping checklist
 * (ShoppingChecklistController). On MySQL (production) that INSERT fails with
 * SQLSTATE[22001] "Data too long", 500-ing the checklist-update request — a bug
 * SQLite hid in CI because it does not enforce string length. 40 leaves
 * headroom for future type slugs.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->string('type', 40)->change();
        });
    }

    public function down(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->string('type', 20)->change();
        });
    }
};
