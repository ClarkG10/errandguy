<?php

use App\Services\CacheService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * "Name your price" (negotiate mode) is retired for launch: every errand is
 * fixed price. This removes what only negotiate mode used:
 *
 *   1. The negotiate_timeout_minutes and max_negotiate_timeout_minutes
 *      settings.
 *   2. Every leftover broadcast offer card (notifications of type
 *      'incoming_request'). Those offers can no longer be accepted, and the job
 *      that used to withdraw them is gone, so they would sit in runners' inboxes
 *      forever.
 *   3. errand_types.min_negotiate_fee (any index on it goes first, because
 *      SQLite won't drop an indexed column).
 *   4. The cached /errand-types catalog and /config/app payload, so the app
 *      stops seeing the removed field and settings straight away.
 *
 * KEPT on purpose: bookings.pricing_mode, customer_offer and
 * negotiate_expires_at. They are history — an older negotiate booking keeps
 * the price it was sold at. New bookings always write 'fixed' / null / null.
 * A negotiate booking still open at deploy time is cancelled and refunded by
 * errandguy:reap-stranded-bookings once its auto-cancel window passes.
 *
 * Every step checks first, so a re-run after a partial failure (MySQL DDL is
 * not transactional) just finishes the job. down() puts the column back
 * (filled with 0) and the settings with their old defaults; the deleted offer
 * cards are gone (deploy.sh takes a backup right before it migrates).
 */
return new class extends Migration
{
    private const RETIRED_SETTINGS = ['negotiate_timeout_minutes', 'max_negotiate_timeout_minutes'];

    public function up(): void
    {
        if (Schema::hasTable('system_config')) {
            DB::table('system_config')->whereIn('key', self::RETIRED_SETTINGS)->delete();
        }

        if (Schema::hasTable('notifications')) {
            DB::table('notifications')->where('type', 'incoming_request')->delete();
        }

        if (Schema::hasTable('errand_types') && Schema::hasColumn('errand_types', 'min_negotiate_fee')) {
            foreach (Schema::getIndexes('errand_types') as $index) {
                if (! $index['primary'] && in_array('min_negotiate_fee', $index['columns'], true)) {
                    Schema::table('errand_types', function (Blueprint $table) use ($index) {
                        $table->dropIndex($index['name']);
                    });
                }
            }

            Schema::table('errand_types', function (Blueprint $table) {
                $table->dropColumn('min_negotiate_fee');
            });
        }

        $this->forgetCaches();
    }

    public function down(): void
    {
        if (Schema::hasTable('errand_types') && ! Schema::hasColumn('errand_types', 'min_negotiate_fee')) {
            Schema::table('errand_types', function (Blueprint $table) {
                $table->decimal('min_negotiate_fee', 8, 2)->default(0);
            });
        }

        if (Schema::hasTable('system_config')) {
            foreach ([
                'negotiate_timeout_minutes' => ['5', 'Minutes a negotiate-mode offer stays open'],
                'max_negotiate_timeout_minutes' => ['30', 'Maximum time in minutes for negotiate pricing to expire'],
            ] as $key => [$value, $description]) {
                if (! DB::table('system_config')->where('key', $key)->exists()) {
                    DB::table('system_config')->insert([
                        'key' => $key,
                        'value' => $value,
                        'description' => $description,
                    ]);
                }
            }
        }

        $this->forgetCaches();
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
            Log::warning('retire_negotiate_pricing: could not drop the config caches', [
                'error' => $e->getMessage(),
            ]);
        }
    }
};
