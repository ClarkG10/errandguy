<?php

use App\Services\CacheService;
use App\Support\SystemSettings;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Puts every setting the code reads (App\Support\SystemSettings) into
 * system_config, so staff see it in the admin panel and can change it:
 * platform fee, payout minimum, matching radius and search rounds, extra-stop
 * fee, accept time, auto-cancel times, runner cash-fee limit, "Buy for me"
 * limit, ops alert recipients, the stall monitor, and the new limits on money
 * staff move by hand (admin_adjustment_daily_cap ₱20,000 a day,
 * admin_adjustment_alert_threshold ₱5,000).
 *
 * Deploys don't run SystemConfigSeeder, so the rows are created here with the
 * value the code already falls back to — nothing changes behaviour. A row that
 * already exists keeps its value; only its description is replaced with the
 * plain one. A re-run is a no-op.
 *
 * down() removes only the two staff-money settings this migration introduced;
 * the other rows hold the code's own defaults, so leaving them is harmless.
 */
return new class extends Migration
{
    private const INTRODUCED = ['admin_adjustment_daily_cap', 'admin_adjustment_alert_threshold'];

    public function up(): void
    {
        if (! Schema::hasTable('system_config')) {
            return;
        }

        foreach (SystemSettings::all() as $key => $definition) {
            $exists = DB::table('system_config')->where('key', $key)->exists();

            if ($exists) {
                DB::table('system_config')->where('key', $key)->update(['description' => $definition['description']]);

                continue;
            }

            // The older single digest address is only a fallback; don't add an
            // empty row for it on a database that never had one.
            if ($key === 'admin_alert_email') {
                continue;
            }

            DB::table('system_config')->insert([
                'key' => $key,
                'value' => $definition['default'],
                'description' => $definition['description'],
            ]);
        }

        $this->forgetCaches();
    }

    public function down(): void
    {
        if (Schema::hasTable('system_config')) {
            DB::table('system_config')->whereIn('key', self::INTRODUCED)->delete();
        }

        $this->forgetCaches();
    }

    /** Best-effort: a cache outage must not fail the deploy's migrate step. */
    private function forgetCaches(): void
    {
        try {
            CacheService::forgetConfig();
            Cache::forget('app_config');
            foreach (array_keys(SystemSettings::all()) as $key) {
                Cache::forget("system_config:{$key}");
            }
        } catch (\Throwable $e) {
            Log::warning('add_missing_settings: could not drop the config caches', [
                'error' => $e->getMessage(),
            ]);
        }
    }
};
