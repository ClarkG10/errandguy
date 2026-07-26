<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Composite (status, created_at) index for the GLOBAL admin booking views.
 *
 * Admin/BookingManagementController filters by `status` then orders by
 * `created_at DESC` platform-wide (no customer_id/runner_id scope), and
 * Admin/DashboardController counts `status='completed'` within a day range.
 * The existing booking composites are all FK-prefixed
 * (idx_bookings_customer_status_created / idx_bookings_runner_status_completed),
 * so a global status-filter + created_at-sort had no covering index — Postgres
 * seeked the single-column idx_bookings_status then sorted the whole status
 * bucket in memory on every admin page.
 *
 * Additive and separately named, so it coexists with the single-column
 * idx_bookings_status and idx_bookings_created_at.
 *
 * See audit finding P16.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->index(['status', 'created_at'], 'idx_bookings_status_created');
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropIndex('idx_bookings_status_created');
        });
    }
};
