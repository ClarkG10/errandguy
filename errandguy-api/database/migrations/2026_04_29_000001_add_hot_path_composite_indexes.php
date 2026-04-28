<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds composite indexes for the hottest read paths surfaced in the
 * mobile app (active booking lookup, runner earnings filter, message
 * unread counts, and per-booking location tracking).
 *
 * All indexes are created with conservative names so they coexist with
 * the existing single-column indexes added by earlier migrations.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            // Customer "active booking" + listing scoped by status.
            $table->index(['customer_id', 'status', 'created_at'], 'idx_bookings_customer_status_created');
            // Runner earnings + history filters.
            $table->index(['runner_id', 'status', 'completed_at'], 'idx_bookings_runner_status_completed');
            // Available offers query in RunnerErrandController::available().
            $table->index(['status', 'pricing_mode', 'negotiate_expires_at'], 'idx_bookings_status_pricing_negotiate');
        });

        Schema::table('messages', function (Blueprint $table) {
            // Unread count per booking, excluding the current sender.
            $table->index(['booking_id', 'sender_id', 'read_at'], 'idx_messages_booking_sender_read');
        });

        Schema::table('runner_locations', function (Blueprint $table) {
            // Latest location per booking (track endpoint).
            $table->index(['booking_id', 'created_at'], 'idx_runner_locations_booking_created');
        });

        Schema::table('notifications', function (Blueprint $table) {
            // Unread notification count.
            $table->index(['user_id', 'is_read'], 'idx_notifications_user_is_read');
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropIndex('idx_bookings_customer_status_created');
            $table->dropIndex('idx_bookings_runner_status_completed');
            $table->dropIndex('idx_bookings_status_pricing_negotiate');
        });

        Schema::table('messages', function (Blueprint $table) {
            $table->dropIndex('idx_messages_booking_sender_read');
        });

        Schema::table('runner_locations', function (Blueprint $table) {
            $table->dropIndex('idx_runner_locations_booking_created');
        });

        Schema::table('notifications', function (Blueprint $table) {
            $table->dropIndex('idx_notifications_user_is_read');
        });
    }
};
