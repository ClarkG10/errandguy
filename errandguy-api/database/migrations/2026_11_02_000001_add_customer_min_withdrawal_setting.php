<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * The customer_min_withdrawal setting: the least a customer can withdraw from
 * their wallet at one time (₱100 to start; 0 means no minimum). Each
 * withdrawal is a payout staff send by hand, so a stream of tiny ones costs
 * more than it moves. The balance paid out when an account is deleted is never
 * held to it, and runners keep their own min_payout_amount.
 *
 * Deploys don't run SystemConfigSeeder, so the row is created here — only when
 * missing, so a value staff already set is kept and a re-run is a no-op.
 * down() removes it (the code falls back to the same ₱100 default).
 */
return new class extends Migration
{
    private const KEY = 'customer_min_withdrawal';

    public function up(): void
    {
        if (! Schema::hasTable('system_config')) {
            return;
        }

        if (! DB::table('system_config')->where('key', self::KEY)->exists()) {
            DB::table('system_config')->insert([
                'key' => self::KEY,
                'value' => '100',
                'description' => 'The least a customer can withdraw from their wallet at one time, in pesos. 0 means no minimum. Withdrawing the balance when deleting an account is never limited.',
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
        } catch (\Throwable $e) {
            Log::warning('add_customer_min_withdrawal_setting: could not drop the config caches', [
                'error' => $e->getMessage(),
            ]);
        }
    }
};
