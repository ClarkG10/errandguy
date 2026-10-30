<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * "Report this person": a customer or runner reports the other party on an
 * errand by opening a support ticket with category 'report_user'. The person
 * being reported is recorded in support_tickets.reported_user_id so staff can
 * see who the report is about and filter for them.
 *
 * If the reported account is ever hard-deleted the ticket stays and the column
 * goes null. Added only when missing, so a re-run is a no-op.
 */
return new class extends Migration
{
    private const INDEX = 'idx_support_tickets_reported_user';

    public function up(): void
    {
        if (! Schema::hasTable('support_tickets') || Schema::hasColumn('support_tickets', 'reported_user_id')) {
            return;
        }

        Schema::table('support_tickets', function (Blueprint $table) {
            $table->uuid('reported_user_id')->nullable()->after('booking_id');
            $table->foreign('reported_user_id')->references('id')->on('users')->nullOnDelete();
            $table->index('reported_user_id', self::INDEX);
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('support_tickets') || ! Schema::hasColumn('support_tickets', 'reported_user_id')) {
            return;
        }

        // MySQL won't drop a column a foreign key uses, nor the index backing
        // it, so the key goes first, then the index, then the column.
        foreach (Schema::getForeignKeys('support_tickets') as $foreignKey) {
            if (in_array('reported_user_id', $foreignKey['columns'], true)) {
                Schema::table('support_tickets', function (Blueprint $table) use ($foreignKey) {
                    if (DB::getDriverName() === 'sqlite' || blank($foreignKey['name'])) {
                        $table->dropForeign(['reported_user_id']);
                    } else {
                        $table->dropForeign($foreignKey['name']);
                    }
                });
            }
        }

        foreach (Schema::getIndexes('support_tickets') as $index) {
            if (! $index['primary'] && in_array('reported_user_id', $index['columns'], true)) {
                Schema::table('support_tickets', function (Blueprint $table) use ($index) {
                    $table->dropIndex($index['name']);
                });
            }
        }

        Schema::table('support_tickets', function (Blueprint $table) {
            $table->dropColumn('reported_user_id');
        });
    }
};
