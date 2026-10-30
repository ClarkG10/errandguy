<?php

use App\Services\CacheService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * The shopping_budget_max setting: the most a runner can be asked to pay for a
 * customer's "Buy for me" items (₱3,000 to start). The runner pays out of
 * pocket and the customer repays them in cash at the door, so the old ₱50,000
 * ceiling was far more than a runner can front. Staff change it in the admin
 * panel; booking creation enforces it and the errand-types catalog serves it.
 *
 * Deploys don't run SystemConfigSeeder, so the row is created here — only when
 * missing, so a value staff already set is kept and a re-run is a no-op.
 * down() removes it (the code falls back to the same ₱3,000 default).
 */
return new class extends Migration
{
    private const KEY = 'shopping_budget_max';

    public function up(): void
    {
        if (! Schema::hasTable('system_config')) {
            return;
        }

        if (! DB::table('system_config')->where('key', self::KEY)->exists()) {
            DB::table('system_config')->insert([
                'key' => self::KEY,
                'value' => '3000',
                'description' => 'Most a runner can pay for a customer’s “Buy for me” items, in pesos. The customer repays it in cash at the door.',
            ]);
        }

        $this->forgetCaches();
    }

    public function down(): void
    {
        if (Schema::hasTable('system_config')) {
            DB::table('system_config')->where('key', self::KEY)->delete();
        }

        $this->forgetCaches();
    }

    /** Best-effort: a cache outage must not fail the deploy's migrate step. */
    private function forgetCaches(): void
    {
        try {
            Cache::forget('system_config:'.self::KEY);
            Cache::forget('app_config');
            Cache::forget(CacheService::errandTypesKey());
        } catch (\Throwable $e) {
            Log::warning('add_shopping_budget_max_setting: could not drop the config caches', [
                'error' => $e->getMessage(),
            ]);
        }
    }
};
