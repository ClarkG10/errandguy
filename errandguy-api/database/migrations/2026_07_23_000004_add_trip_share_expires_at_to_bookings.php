<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Add a TTL to public trip-share links.
 *
 * `bookings.trip_share_token` previously had NO time bound — once a customer
 * shared a link it resolved forever (subject only to the booking not being
 * terminal), leaking live location + pickup/dropoff addresses to anyone the
 * URL was forwarded to. This adds an expiry the public resolver enforces.
 *
 * The column is nullable: existing/other-writer links with a NULL expiry
 * still resolve (the resolver uses a lenient `NULL OR > now()` predicate) so
 * we never 404 a live in-progress trip. We DO backfill currently-active links
 * with a bounded expiry so pre-existing shares don't stay unbounded forever.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->timestampTz('trip_share_expires_at')->nullable();
        });

        // Bound any links that are active RIGHT NOW so the leak is closed for
        // pre-existing shares too. Uses the same configured TTL as share().
        $ttlHours = (int) config('safety.trip_share_ttl_hours', 24);
        DB::table('bookings')
            ->where('trip_share_active', true)
            ->update(['trip_share_expires_at' => now()->addHours($ttlHours)]);
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn('trip_share_expires_at');
        });
    }
};
