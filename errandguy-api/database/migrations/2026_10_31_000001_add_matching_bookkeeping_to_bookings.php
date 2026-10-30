<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What matching needs to remember about each errand:
 *
 *   - offered_runner_ids: every runner the errand has been offered to. A runner
 *     who declined it, let the offer lapse, or was taken off it by staff is
 *     never offered it again, so an errand can no longer bounce between the
 *     same few runners forever.
 *   - offer_count: offers made in the current round. Matching gives up (no
 *     runner, full refund) once it reaches matching_max_offers. A customer's
 *     "try again" or a staff re-run starts a new round.
 *   - matching_started_at: when matching first ran. The scheduled-errand sweep
 *     uses it to spot an errand whose delayed matching task was lost.
 *
 * All three are nullable or defaulted, so existing rows need no backfill. Each
 * column is added only when missing, so a re-run after a partial failure just
 * finishes the job.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('bookings')) {
            return;
        }

        if (! Schema::hasColumn('bookings', 'offered_runner_ids')) {
            Schema::table('bookings', function (Blueprint $table) {
                $table->json('offered_runner_ids')->nullable();
            });
        }

        if (! Schema::hasColumn('bookings', 'offer_count')) {
            Schema::table('bookings', function (Blueprint $table) {
                $table->unsignedSmallInteger('offer_count')->default(0);
            });
        }

        if (! Schema::hasColumn('bookings', 'matching_started_at')) {
            Schema::table('bookings', function (Blueprint $table) {
                $table->timestampTz('matching_started_at')->nullable();
            });
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('bookings')) {
            return;
        }

        foreach (['offered_runner_ids', 'offer_count', 'matching_started_at'] as $column) {
            if (Schema::hasColumn('bookings', $column)) {
                Schema::table('bookings', function (Blueprint $table) use ($column) {
                    $table->dropColumn($column);
                });
            }
        }
    }
};
