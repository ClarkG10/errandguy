<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * RetractOfferJob withdraws a broadcast offer from every runner who didn't win
 * it:
 *   WHERE type='incoming_request' AND data->booking_id = ?
 *
 * notifications only carried (user_id, created_at) and (user_id, archived_at)
 * — both user-scoped, and this query is deliberately NOT user-scoped, so
 * neither could serve it. The JSON-path predicate is unindexable on its own,
 * which left a FULL SCAN of a table that grows with every notification the
 * platform has ever sent, fired once per negotiate booking that gets accepted,
 * expires or is cancelled.
 *
 * Indexing `type` lets the planner seek to the incoming_request bucket and
 * evaluate the JSON path only across that much smaller set. created_at is
 * carried as the second column so the archival/pruning sweeps that order by it
 * read in index order too. Additive; coexists with the user-scoped indexes.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->index(['type', 'created_at'], 'idx_notifications_type_created');
        });
    }

    public function down(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->dropIndex('idx_notifications_type_created');
        });
    }
};
