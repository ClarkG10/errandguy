<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Two facts an SOS alert could not record:
 *
 *   - WHERE the person who pressed it is. customer_lat/lng only ever held the
 *     errand's drop-off point and runner_lat/lng the runner's last ping, so a
 *     customer pressing SOS somewhere else showed staff the wrong place. The
 *     phone now sends its own GPS fix with the alert:
 *       trigger_lat / trigger_lng  — that fix, or the best fallback;
 *       trigger_accuracy_m         — the phone's accuracy radius in metres;
 *       trigger_location_source    — device | runner_last_known | errand_point.
 *   - WHO closed it: resolved_by (the user or admin id) and resolved_by_type
 *     (customer | runner | admin | system). No foreign key, since the id can
 *     point at users or admin_users.
 *
 * Every column is added only when missing, so a re-run after a partial
 * failure (MySQL DDL is not transactional) just finishes the job.
 */
return new class extends Migration
{
    private const COLUMNS = [
        'trigger_lat',
        'trigger_lng',
        'trigger_accuracy_m',
        'trigger_location_source',
        'resolved_by',
        'resolved_by_type',
    ];

    public function up(): void
    {
        if (! Schema::hasTable('sos_alerts')) {
            return;
        }

        Schema::table('sos_alerts', function (Blueprint $table) {
            if (! Schema::hasColumn('sos_alerts', 'trigger_lat')) {
                $table->decimal('trigger_lat', 10, 7)->nullable();
            }
            if (! Schema::hasColumn('sos_alerts', 'trigger_lng')) {
                $table->decimal('trigger_lng', 10, 7)->nullable();
            }
            if (! Schema::hasColumn('sos_alerts', 'trigger_accuracy_m')) {
                $table->decimal('trigger_accuracy_m', 9, 1)->nullable();
            }
            if (! Schema::hasColumn('sos_alerts', 'trigger_location_source')) {
                $table->string('trigger_location_source', 20)->nullable();
            }
            if (! Schema::hasColumn('sos_alerts', 'resolved_by')) {
                $table->uuid('resolved_by')->nullable();
            }
            if (! Schema::hasColumn('sos_alerts', 'resolved_by_type')) {
                $table->string('resolved_by_type', 10)->nullable();
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('sos_alerts')) {
            return;
        }

        $columns = array_values(array_filter(
            self::COLUMNS,
            fn (string $column): bool => Schema::hasColumn('sos_alerts', $column),
        ));

        if ($columns !== []) {
            Schema::table('sos_alerts', function (Blueprint $table) use ($columns) {
                $table->dropColumn($columns);
            });
        }
    }
};
