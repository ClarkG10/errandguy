<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Promo codes — frequently filtered by (code, is_active) during booking
        Schema::table('promo_codes', function (Blueprint $table) {
            $table->index(['code', 'is_active']);
        });

        // SOS alerts — admin queries active alerts
        Schema::table('sos_alerts', function (Blueprint $table) {
            $table->index('status');
        });

        // Dispute tickets — admin dashboard filters by status
        Schema::table('dispute_tickets', function (Blueprint $table) {
            $table->index('status');
            $table->index('reported_by');
        });

        // Runner documents — filtered by (runner_id, status) for verification queries
        Schema::table('runner_documents', function (Blueprint $table) {
            $table->index(['runner_id', 'status']);
        });

        // Errand types — filtered by is_active on every app load
        Schema::table('errand_types', function (Blueprint $table) {
            $table->index('is_active');
        });

        // Bookings — completed_at used in dashboard/earnings queries
        Schema::table('bookings', function (Blueprint $table) {
            $table->index('completed_at');
        });
    }

    public function down(): void
    {
        Schema::table('promo_codes', function (Blueprint $table) {
            $table->dropIndex(['code', 'is_active']);
        });

        Schema::table('sos_alerts', function (Blueprint $table) {
            $table->dropIndex(['status']);
        });

        Schema::table('dispute_tickets', function (Blueprint $table) {
            $table->dropIndex(['status']);
            $table->dropIndex(['reported_by']);
        });

        Schema::table('runner_documents', function (Blueprint $table) {
            $table->dropIndex(['runner_id', 'status']);
        });

        Schema::table('errand_types', function (Blueprint $table) {
            $table->dropIndex(['is_active']);
        });

        Schema::table('bookings', function (Blueprint $table) {
            $table->dropIndex(['completed_at']);
        });
    }
};
