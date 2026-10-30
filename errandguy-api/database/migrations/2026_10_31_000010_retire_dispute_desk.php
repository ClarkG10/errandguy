<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * The Disputes desk is retired: support tickets are the one complaint channel,
 * and refunds are made from the payment itself. This drops dispute_tickets.
 *
 * Nothing is lost silently. Before the table goes, every row is copied, as
 * JSON, to two places:
 *   - the activity log (log_name 'retired_disputes', event 'archived'), which
 *     staff can read in the admin panel under Activity log; and
 *   - the application log, one warning line per row
 *     ("Retired dispute ticket archived").
 * deploy.sh also takes a full database backup right before it migrates.
 *
 * Safe to re-run: once the table is gone there is nothing to copy or drop.
 * down() rebuilds the empty table only; the rows live on in the activity log.
 */
return new class extends Migration
{
    private const TABLE = 'dispute_tickets';

    public function up(): void
    {
        if (! Schema::hasTable(self::TABLE)) {
            return;
        }

        $archiveToActivityLog = Schema::hasTable('activity_log');
        $archived = 0;

        DB::table(self::TABLE)->orderBy('created_at')->orderBy('id')->chunk(200, function ($rows) use ($archiveToActivityLog, &$archived) {
            foreach ($rows as $row) {
                $data = (array) $row;

                Log::warning('Retired dispute ticket archived', ['dispute_ticket' => $data]);

                if ($archiveToActivityLog) {
                    DB::table('activity_log')->insert([
                        'log_name' => 'retired_disputes',
                        'description' => 'Dispute ticket '.$data['id'].' archived when the Disputes desk was retired',
                        'event' => 'archived',
                        'properties' => json_encode(['dispute_ticket' => $data]),
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                }

                $archived++;
            }
        });

        if ($archived > 0) {
            Log::warning('Disputes desk retired', ['archived_dispute_tickets' => $archived]);
        }

        Schema::drop(self::TABLE);
    }

    public function down(): void
    {
        if (Schema::hasTable(self::TABLE)) {
            return;
        }

        // Mirrors 2026_03_26_200018 + the indexes from 2026_04_08_000001.
        Schema::create(self::TABLE, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('booking_id');
            $table->uuid('reported_by');
            $table->string('category', 30);
            $table->text('description');
            $table->jsonb('evidence_urls')->default(new \Illuminate\Database\Query\Expression("('[]')"));
            $table->string('status', 15)->default('open');
            $table->text('resolution')->nullable();
            $table->uuid('resolved_by')->nullable();
            $table->timestampTz('resolved_at')->nullable();
            $table->timestampsTz();

            $table->foreign('booking_id')->references('id')->on('bookings');
            $table->foreign('reported_by')->references('id')->on('users');
            $table->index('booking_id', 'idx_dispute_tickets_booking_id');
            $table->index('status');
            $table->index('reported_by');
        });
    }
};
