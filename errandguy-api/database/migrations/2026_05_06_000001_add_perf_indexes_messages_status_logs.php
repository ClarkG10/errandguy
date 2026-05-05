<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Two follow-on indexes that the original hot-path index migration
 * missed:
 *
 *  - messages(booking_id, created_at): Postgres needs the leading
 *    column matched + the sort column to use a single index scan for
 *    "latest message in conversation" reads. The existing
 *    idx_messages_booking_sender_read covers the unread-count path
 *    but forces a sort step for chat history + the new DISTINCT ON
 *    inbox query.
 *
 *  - booking_status_logs(booking_id, created_at): the BookingResource
 *    serializes statusLogs ordered by time on every tracking-screen
 *    poll. Without this composite the planner does an index lookup +
 *    in-memory sort on every read, growing linearly with the number
 *    of transitions per booking.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->index(['booking_id', 'created_at'], 'idx_messages_booking_created');
        });

        Schema::table('booking_status_logs', function (Blueprint $table) {
            $table->index(['booking_id', 'created_at'], 'idx_status_logs_booking_created');
        });
    }

    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->dropIndex('idx_messages_booking_created');
        });

        Schema::table('booking_status_logs', function (Blueprint $table) {
            $table->dropIndex('idx_status_logs_booking_created');
        });
    }
};
