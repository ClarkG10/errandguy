<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Staff could not reply to a support ticket at all.
 *
 * support_messages.sender_id says who wrote a message, and WHERE that id lives
 * depends on sender_type: a 'user' message holds a users id, an 'agent' reply
 * (written from the staff panel) holds an admin_users id. The table was created
 * with a foreign key from sender_id to users, so every agent reply failed the
 * key and the panel answered with a server error: tickets could be opened but
 * never answered.
 *
 * A single foreign key can't point at two tables, so it goes. The index MySQL
 * built for it stays (account erasure looks messages up by sender_id). Nothing
 * relied on the key's ON DELETE SET NULL: accounts are erased in place, never
 * deleted, and a message whose sender is gone already shows as "Support" or
 * the ticket owner's name.
 *
 * Found by column rather than by name, so a key created under another name is
 * dropped too, and a re-run after a partial failure does nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('support_messages')) {
            return;
        }

        foreach (Schema::getForeignKeys('support_messages') as $foreignKey) {
            if ($foreignKey['columns'] !== ['sender_id']) {
                continue;
            }

            Schema::table('support_messages', function (Blueprint $table) use ($foreignKey) {
                if (DB::getDriverName() === 'sqlite' || blank($foreignKey['name'])) {
                    $table->dropForeign(['sender_id']);
                } else {
                    $table->dropForeign($foreignKey['name']);
                }
            });
        }
    }

    /**
     * Puts the key back only when every sender_id still names a users row;
     * once staff have replied, the agent rows would fail it, so it stays off.
     */
    public function down(): void
    {
        if (! Schema::hasTable('support_messages')) {
            return;
        }

        $orphans = DB::table('support_messages')
            ->whereNotNull('sender_id')
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('users')->whereColumn('users.id', 'support_messages.sender_id'))
            ->exists();

        if ($orphans) {
            return;
        }

        Schema::table('support_messages', function (Blueprint $table) {
            $table->foreign('sender_id')->references('id')->on('users')->nullOnDelete();
        });
    }
};
