<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * An erased account kept status 'active' (erasure anonymises the row and
 * soft-deletes it, but never set the status), so staff saw it as a live
 * account with Suspend and Adjust wallet offered. AccountErasureService now
 * sets 'deleted'; this brings the accounts erased before that in line.
 *
 * Only 'active' rows: one suspended before it was erased keeps that history.
 * down() leaves them: 'deleted' is the true state.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('users')
            ->whereNotNull('deleted_at')
            ->where('status', 'active')
            ->update(['status' => 'deleted']);
    }

    public function down(): void
    {
        //
    }
};
