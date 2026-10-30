<?php

use App\Services\CacheService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Who staff alerts reach outside the admin panel:
 *
 *   - ops_alert_emails: the addresses emailed the moment someone presses SOS,
 *     and the addresses the ops digest goes to;
 *   - ops_alert_phone:  the numbers texted the moment someone presses SOS.
 *
 * Both start empty and are filled in by staff under System → System configs.
 * Deploys don't run SystemConfigSeeder, so the rows are created here — only
 * when missing, so a value staff already set is kept and a re-run is a no-op.
 * If an older admin_alert_email setting holds an address, ops_alert_emails
 * starts with it so the digest keeps going where it went before.
 */
return new class extends Migration
{
    private const SETTINGS = [
        'ops_alert_emails' => 'Email addresses (separate with commas) that get an email the moment someone presses SOS, and the ops digest. Leave empty to send none.',
        'ops_alert_phone' => 'Mobile numbers (separate with commas, e.g. 09171234567) that get a text the moment someone presses SOS. Needs the SMS service to be set up. Leave empty to send none.',
    ];

    public function up(): void
    {
        if (! Schema::hasTable('system_config')) {
            return;
        }

        foreach (self::SETTINGS as $key => $description) {
            if (DB::table('system_config')->where('key', $key)->exists()) {
                continue;
            }

            $value = '';
            if ($key === 'ops_alert_emails') {
                $value = (string) (DB::table('system_config')->where('key', 'admin_alert_email')->value('value') ?? '');
            }

            DB::table('system_config')->insert([
                'key' => $key,
                'value' => $value,
                'description' => $description,
            ]);
        }

        $this->forgetCaches();
    }

    public function down(): void
    {
        if (Schema::hasTable('system_config')) {
            DB::table('system_config')->whereIn('key', array_keys(self::SETTINGS))->delete();
        }

        $this->forgetCaches();
    }

    /** Best-effort: a cache outage must not fail the deploy's migrate step. */
    private function forgetCaches(): void
    {
        try {
            CacheService::forgetConfig();
            foreach (array_keys(self::SETTINGS) as $key) {
                Cache::forget("system_config:{$key}");
            }
        } catch (\Throwable $e) {
            Log::warning('add_ops_alert_settings: could not drop the config caches', [
                'error' => $e->getMessage(),
            ]);
        }
    }
};
