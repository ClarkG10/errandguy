<?php

use App\Services\CacheService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Launch catalog: ten errand types become four.
 *
 *   - delivery ("Delivery") now also covers documents and laundry;
 *   - purchase ("Buy for me") now also covers food and groceries;
 *   - queue ("Queue / Pila") and custom ("Custom errand") stay;
 *   - passenger rides (transportation) and Bills Payment are gone.
 *
 * What this does, in order (every step is a no-op when there is nothing to do,
 * so a re-run after a partial failure just finishes the job):
 *
 *   1. Switches the six retired types OFF. Their rows stay so older bookings
 *      still show their type; booking creation already rejects inactive types.
 *   2. Gives the four kept types their launch names, sort order 1–4 and
 *      is_active = true, plus new descriptions for delivery and purchase (queue
 *      and custom keep theirs). This one-time overwrite is safe: every deploy
 *      until now ran ErrandTypeSeeder with updateOrCreate, which reset names
 *      and descriptions to the seeder defaults anyway, so there are no staff
 *      edits to lose. Prices are left exactly as they are.
 *   3. Remaps each runner's preferred types (runner_profiles.preferred_types, a
 *      JSON list of slugs): document/laundry → delivery, food/grocery →
 *      purchase, bills_payment/transportation dropped, duplicates removed. A
 *      runner whose every choice was retired gets all four types, because an
 *      empty list blocks going online. A runner who had chosen nothing is left
 *      alone, and unknown values are kept as they are.
 *   4. Deletes the settings only the removed ride/off-route monitors read
 *      (ride_duration_alert_multiplier, route_deviation_threshold_meters).
 *   5. Drops the cached /errand-types catalog so the app sees four types at once
 *      instead of after the cache's hourly refresh.
 *
 * Runner-side handling of retired slugs (an errand booked before today still
 * finishes the way it was booked) lives in UpdateErrandStatusRequest and
 * RunnerErrandController, and matching an unstarted one to the remapped
 * preferences in ErrandType::RETIRED_SUCCESSORS — not here.
 *
 * down() switches the six retired types back on. Everything else is data this
 * migration overwrote and cannot know the old value of (deploy.sh takes a
 * backup right before it migrates).
 */
return new class extends Migration
{
    private const RETIRED_SLUGS = ['document', 'laundry', 'food', 'grocery', 'bills_payment', 'transportation'];

    /** Kept types, in their launch order. A null description means "keep the current one". */
    private const ACTIVE_TYPES = [
        'delivery' => [
            'name' => 'Delivery',
            'description' => 'Parcels, documents or laundry — picked up and dropped off',
        ],
        'purchase' => [
            'name' => 'Buy for me',
            'description' => 'Groceries, food or anything you need — bought and brought to you',
        ],
        'queue' => ['name' => 'Queue / Pila', 'description' => null],
        'custom' => ['name' => 'Custom errand', 'description' => null],
    ];

    /** Retired slug → the kept slug that now covers it; null = no replacement. */
    private const PREFERENCE_MAP = [
        'document' => 'delivery',
        'laundry' => 'delivery',
        'food' => 'purchase',
        'grocery' => 'purchase',
        'bills_payment' => null,
        'transportation' => null,
    ];

    private const RETIRED_SETTINGS = ['ride_duration_alert_multiplier', 'route_deviation_threshold_meters'];

    public function up(): void
    {
        if (Schema::hasTable('errand_types')) {
            DB::table('errand_types')
                ->whereIn('slug', self::RETIRED_SLUGS)
                ->where('is_active', true)
                ->update(['is_active' => false]);

            $sortOrder = 0;
            foreach (self::ACTIVE_TYPES as $slug => $copy) {
                $sortOrder++;
                $changes = array_filter([
                    'name' => $copy['name'],
                    'description' => $copy['description'],
                    'sort_order' => $sortOrder,
                    'is_active' => true,
                ], fn ($value) => $value !== null);

                DB::table('errand_types')->where('slug', $slug)->update($changes);
            }
        }

        if (Schema::hasTable('runner_profiles') && Schema::hasColumn('runner_profiles', 'preferred_types')) {
            $this->remapPreferredTypes();
        }

        if (Schema::hasTable('system_config')) {
            DB::table('system_config')->whereIn('key', self::RETIRED_SETTINGS)->delete();
        }

        $this->forgetCatalogCache();
    }

    public function down(): void
    {
        if (Schema::hasTable('errand_types')) {
            DB::table('errand_types')
                ->whereIn('slug', self::RETIRED_SLUGS)
                ->update(['is_active' => true]);
        }

        $this->forgetCatalogCache();
    }

    private function remapPreferredTypes(): void
    {
        $everyActiveType = array_keys(self::ACTIVE_TYPES);

        DB::table('runner_profiles')
            ->select(['id', 'preferred_types'])
            ->chunkById(500, function ($profiles) use ($everyActiveType) {
                foreach ($profiles as $profile) {
                    $current = $this->decodeSlugs($profile->preferred_types);
                    if ($current === null || array_intersect($current, self::RETIRED_SLUGS) === []) {
                        continue;
                    }

                    $remapped = [];
                    foreach ($current as $slug) {
                        $slug = array_key_exists($slug, self::PREFERENCE_MAP) ? self::PREFERENCE_MAP[$slug] : $slug;
                        if ($slug !== null && ! in_array($slug, $remapped, true)) {
                            $remapped[] = $slug;
                        }
                    }

                    if ($remapped === []) {
                        $remapped = $everyActiveType;
                    }

                    DB::table('runner_profiles')
                        ->where('id', $profile->id)
                        ->update(['preferred_types' => json_encode($remapped)]);
                }
            });
    }

    /**
     * The stored JSON list as an array of strings, or null when it is not a
     * list (empty, malformed) and there is nothing to remap. Tolerates a value
     * that was JSON-encoded twice.
     *
     * @return list<string>|null
     */
    private function decodeSlugs(mixed $raw): ?array
    {
        $value = $raw;
        for ($i = 0; $i < 2 && is_string($value); $i++) {
            $value = json_decode($value, true);
        }

        if (! is_array($value) || $value === []) {
            return null;
        }

        return array_values(array_map('strval', array_filter($value, 'is_scalar')));
    }

    /** Best-effort: a cache outage must not fail the deploy's migrate step. */
    private function forgetCatalogCache(): void
    {
        try {
            Cache::forget(CacheService::errandTypesKey());
        } catch (\Throwable $e) {
            Log::warning('simplify_errand_catalog: could not drop the errand-types cache', [
                'error' => $e->getMessage(),
            ]);
        }
    }
};
