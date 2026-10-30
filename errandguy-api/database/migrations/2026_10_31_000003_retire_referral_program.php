<?php

use App\Services\CacheService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * The referral program is retired for launch, so drop everything only it used:
 *
 *   - the referrals table;
 *   - users.referral_code (and its unique index) and users.referred_by (and
 *     its foreign key and index);
 *   - the referral_reward_amount and referral_max_rewards_per_referrer
 *     settings.
 *
 * KEPT on purpose: users.bonus_balance and every wallet_transactions row
 * (including the 'bonus' credits the program wrote). Bonus money a customer
 * already has stays spendable, drawn down before their real balance, until it
 * is used up; nothing new is ever credited to it.
 *
 * Every step checks first, so a re-run after a partial failure (MySQL DDL is
 * not transactional) just finishes the job:
 *   - MySQL won't drop a column a foreign key uses, nor the index backing it,
 *     so the key is found by column and dropped first. SQLite has no key names
 *     and rebuilds the table to drop one, which dropForeign([column]) does.
 *   - SQLite won't drop an indexed column, so any index on the columns goes
 *     next (that includes the unique index on referral_code).
 *
 * down() rebuilds the structure only (codes empty, nobody referred); the
 * dropped rows are gone (deploy.sh takes a backup right before it migrates).
 */
return new class extends Migration
{
    private const USER_COLUMNS = ['referral_code', 'referred_by'];

    private const RETIRED_SETTINGS = ['referral_reward_amount', 'referral_max_rewards_per_referrer'];

    public function up(): void
    {
        Schema::dropIfExists('referrals');

        if (Schema::hasTable('users')) {
            $this->dropReferredByForeignKeys();

            $columns = array_values(array_filter(
                self::USER_COLUMNS,
                fn (string $column): bool => Schema::hasColumn('users', $column),
            ));

            if ($columns !== []) {
                foreach (Schema::getIndexes('users') as $index) {
                    if (! $index['primary'] && array_intersect($index['columns'], $columns) !== []) {
                        Schema::table('users', function (Blueprint $table) use ($index) {
                            $table->dropIndex($index['name']);
                        });
                    }
                }

                Schema::table('users', function (Blueprint $table) use ($columns) {
                    $table->dropColumn($columns);
                });
            }
        }

        if (Schema::hasTable('system_config')) {
            DB::table('system_config')->whereIn('key', self::RETIRED_SETTINGS)->delete();
        }

        $this->forgetCaches();
    }

    public function down(): void
    {
        // Mirrors 2026_07_10_000002.
        if (! Schema::hasTable('referrals')) {
            Schema::create('referrals', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('referrer_id');
                $table->uuid('referee_id');
                $table->string('status', 15)->default('pending');
                $table->decimal('reward_amount', 10, 2)->nullable();
                $table->timestampTz('qualified_at')->nullable();
                $table->timestampTz('rewarded_at')->nullable();
                $table->timestampTz('created_at')->useCurrent();

                $table->foreign('referrer_id')->references('id')->on('users')->cascadeOnDelete();
                $table->foreign('referee_id')->references('id')->on('users')->cascadeOnDelete();

                $table->unique('referee_id', 'uq_referrals_referee_id');
                $table->index('referrer_id', 'idx_referrals_referrer_id');
            });
        }

        if (! Schema::hasTable('users')) {
            return;
        }

        // Mirrors 2026_07_10_000001.
        if (! Schema::hasColumn('users', 'referral_code')) {
            Schema::table('users', function (Blueprint $table) {
                $table->string('referral_code', 12)->nullable()->unique()->after('last_active_at');
            });
        }

        if (! Schema::hasColumn('users', 'referred_by')) {
            Schema::table('users', function (Blueprint $table) {
                $table->uuid('referred_by')->nullable()->after('referral_code');
                $table->foreign('referred_by')->references('id')->on('users')->nullOnDelete();
                $table->index('referred_by', 'idx_users_referred_by');
            });
        }
    }

    /**
     * Drop the foreign key from users.referred_by to users, if there is one.
     * Found by column rather than by name, so a key created under another name
     * is dropped too.
     */
    private function dropReferredByForeignKeys(): void
    {
        if (! Schema::hasColumn('users', 'referred_by')) {
            return;
        }

        foreach (Schema::getForeignKeys('users') as $foreignKey) {
            if (! in_array('referred_by', $foreignKey['columns'], true)) {
                continue;
            }

            Schema::table('users', function (Blueprint $table) use ($foreignKey) {
                if (DB::getDriverName() === 'sqlite' || blank($foreignKey['name'])) {
                    $table->dropForeign(['referred_by']);
                } else {
                    $table->dropForeign($foreignKey['name']);
                }
            });
        }
    }

    /** Best-effort: a cache outage must not fail the deploy's migrate step. */
    private function forgetCaches(): void
    {
        try {
            CacheService::forgetConfig();
            foreach (self::RETIRED_SETTINGS as $key) {
                Cache::forget("system_config:{$key}");
            }
        } catch (\Throwable $e) {
            Log::warning('retire_referral_program: could not drop the config caches', [
                'error' => $e->getMessage(),
            ]);
        }
    }
};
