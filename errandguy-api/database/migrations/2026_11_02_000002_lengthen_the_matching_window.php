<?php

use App\Services\CacheService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * How long matching looks for a runner for an errand booked for now.
 *
 *   - auto_cancel_timeout_minutes: SystemConfigSeeder used to seed 5 while the
 *     code defaults to 30. Offers now go to one runner at a time — up to five,
 *     90 seconds each — so 5 minutes ended most searches before the last
 *     offers were even made. A database still holding exactly the old seeded
 *     5 is raised to 30; any other value is a staff choice and is kept.
 *   - retry_auto_cancel_timeout_minutes: nothing reads it any more. A
 *     customer's "try again" (like a staff re-run or "Return to matching")
 *     now starts a full new search window (BookingService::freshRound), so
 *     the row is removed rather than left in the admin panel doing nothing.
 *
 * A re-run is a no-op. down() puts the retry row back with its old value; it
 * leaves the timeout alone, since 30 is the code's own default and dropping it
 * back to 5 would bring the cut-short searches back.
 */
return new class extends Migration
{
    private const TIMEOUT_KEY = 'auto_cancel_timeout_minutes';

    private const RETRY_KEY = 'retry_auto_cancel_timeout_minutes';

    public function up(): void
    {
        if (! Schema::hasTable('system_config')) {
            return;
        }

        DB::table('system_config')
            ->where('key', self::TIMEOUT_KEY)
            ->where('value', '5')
            ->update(['value' => '30']);

        DB::table('system_config')->where('key', self::RETRY_KEY)->delete();

        $this->forgetCaches();
    }

    public function down(): void
    {
        if (Schema::hasTable('system_config')
            && ! DB::table('system_config')->where('key', self::RETRY_KEY)->exists()) {
            DB::table('system_config')->insert([
                'key' => self::RETRY_KEY,
                'value' => '5',
                'description' => 'How long a customer’s “Search again” keeps looking before giving up.',
            ]);
        }

        $this->forgetCaches();
    }

    /** Best-effort: a cache outage must not fail the deploy's migrate step. */
    private function forgetCaches(): void
    {
        try {
            CacheService::forgetConfig();
            Cache::forget('app_config');
            Cache::forget('system_config:'.self::TIMEOUT_KEY);
            Cache::forget('system_config:'.self::RETRY_KEY);
        } catch (\Throwable $e) {
            Log::warning('lengthen_the_matching_window: could not drop the config caches', [
                'error' => $e->getMessage(),
            ]);
        }
    }
};
