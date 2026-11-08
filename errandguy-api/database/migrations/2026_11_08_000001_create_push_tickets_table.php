<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Expo push tickets waiting for their receipts. A ticket of "ok" only means
 * Expo accepted the message; whether Apple/Google delivered it (or rejected
 * our credentials, or the app was uninstalled) arrives later as a receipt,
 * which nothing ever asked for. errandguy:check-push-receipts reads these
 * rows after ~15 minutes and deletes them; Expo keeps receipts for a day.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('push_tickets', function (Blueprint $table) {
            $table->id();
            $table->string('ticket_id', 64)->unique();
            $table->string('token', 255);
            $table->timestamp('created_at')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('push_tickets');
    }
};
