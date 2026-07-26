<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * pg_trgm GIN indexes to accelerate the admin user search.
 *
 * Admin/UserManagementController searches
 *   full_name ILIKE '%term%' OR email ILIKE '%term%' OR phone ILIKE '%term%'
 * The leading `%` makes all three columns unindexable by a B-tree, so every
 * admin search is a sequential scan of `users`. A GIN trigram index
 * index-accelerates the *contains* ILIKE WITHOUT changing its semantics —
 * unlike anchoring to a prefix search (dropping the leading `%`), which would be
 * a functional regression.
 *
 * POSTGRES-ONLY: pg_trgm / gin_trgm_ops don't exist on the sqlite test driver,
 * so the whole migration no-ops off Postgres (keeps `migrate` green under the
 * sqlite test suite). CREATE INDEX CONCURRENTLY is intentionally NOT used (it
 * can't run inside Laravel's migration transaction); if `users` is already
 * large, run this in a low-traffic window or build the indexes CONCURRENTLY by
 * hand instead.
 *
 * See audit finding P40 — deferrable (reasonable to hold until the users table
 * grows). Authored but NOT auto-run; apply with `php artisan migrate` when ready.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        DB::statement('CREATE INDEX IF NOT EXISTS idx_users_full_name_trgm ON users USING gin (full_name gin_trgm_ops)');
        DB::statement('CREATE INDEX IF NOT EXISTS idx_users_email_trgm ON users USING gin (email gin_trgm_ops)');
        DB::statement('CREATE INDEX IF NOT EXISTS idx_users_phone_trgm ON users USING gin (phone gin_trgm_ops)');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement('DROP INDEX IF EXISTS idx_users_full_name_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_users_email_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_users_phone_trgm');
        // Leave the pg_trgm extension installed — other objects may rely on it.
    }
};
