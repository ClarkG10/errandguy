<?php

use App\Services\CacheService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Settings nothing ever read, shown in the admin panel as if changing them did
 * something:
 *
 *   - sos_link_expiry_minutes: the SOS live link lasts 60 minutes, set in
 *     SOSService;
 *   - location_update_interval_seconds: the app decides how often it sends
 *     location;
 *   - max_saved_addresses / max_trusted_contacts: the limits (10 and 5) are
 *     set in SavedAddressController and TrustedContactController;
 *   - runner_payout_percent: the runner's share is the price minus
 *     platform_fee_percent (PricingService).
 *
 * Deleting a row that is already gone is a no-op, so a re-run is safe.
 * down() puts the rows back with their seeded values.
 */
return new class extends Migration
{
    private const RETIRED = [
        'sos_link_expiry_minutes' => ['60', 'Minutes before SOS live tracking link expires'],
        'location_update_interval_seconds' => ['5', 'Seconds between runner location updates'],
        'max_saved_addresses' => ['10', 'Maximum number of saved addresses per user'],
        'max_trusted_contacts' => ['5', 'Maximum number of trusted contacts per user'],
        'runner_payout_percent' => ['85', 'Percentage of booking amount paid to runner'],
    ];

    public function up(): void
    {
        if (Schema::hasTable('system_config')) {
            DB::table('system_config')->whereIn('key', array_keys(self::RETIRED))->delete();
        }

        $this->forgetCaches();
    }

    public function down(): void
    {
        if (! Schema::hasTable('system_config')) {
            return;
        }

        foreach (self::RETIRED as $key => [$value, $description]) {
            if (! DB::table('system_config')->where('key', $key)->exists()) {
                DB::table('system_config')->insert([
                    'key' => $key,
                    'value' => $value,
                    'description' => $description,
                ]);
            }
        }

        $this->forgetCaches();
    }

    /** Best-effort: a cache outage must not fail the deploy's migrate step. */
    private function forgetCaches(): void
    {
        try {
            CacheService::forgetConfig();
            foreach (array_keys(self::RETIRED) as $key) {
                Cache::forget("system_config:{$key}");
            }
        } catch (\Throwable $e) {
            Log::warning('remove_unused_settings: could not drop the config caches', [
                'error' => $e->getMessage(),
            ]);
        }
    }
};
