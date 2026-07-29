<?php

namespace App\Support;

use Illuminate\Support\Carbon;

/**
 * Helpers for the admin dashboard chart widgets: build a gap-filled daily axis
 * so a day with zero activity still shows as a point on the line (instead of
 * the series silently collapsing). App + DB both run in UTC, so `today()` lines
 * up 1:1 with pgsql `to_char(col, 'YYYY-MM-DD')` buckets.
 */
class AdminChartData
{
    /** Ordered map ['YYYY-MM-DD' => 0.0] for the last $days days, oldest → newest. */
    public static function emptyDailyMap(int $days): array
    {
        $map = [];
        for ($i = $days - 1; $i >= 0; $i--) {
            $map[today()->subDays($i)->toDateString()] = 0.0;
        }

        return $map;
    }

    /** Human axis labels for a daily map (e.g. "May 5"). Sparse ticks on long ranges. */
    public static function labels(array $map, int $days): array
    {
        $keys = array_keys($map);
        $every = $days > 45 ? 7 : ($days > 20 ? 3 : 1);

        return array_map(
            fn (string $d, int $i): string => ($i % $every === 0 || $i === count($keys) - 1)
                ? Carbon::parse($d)->format('M j')
                : '',
            $keys,
            array_keys($keys),
        );
    }

    /** The first date in the window as a Carbon (start of the range). */
    public static function since(int $days): Carbon
    {
        return today()->subDays($days - 1);
    }
}
