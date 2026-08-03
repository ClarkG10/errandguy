<?php

namespace App\Support;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Helpers for the admin dashboard chart widgets: build a gap-filled daily axis
 * so a day with zero activity still shows as a point on the line (instead of
 * the series silently collapsing). App + DB both run in UTC, so `today()` lines
 * up 1:1 with the driver-aware day buckets from {@see dayBucket()}.
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

    /**
     * SQL expression bucketing a datetime column to a 'YYYY-MM-DD' day string,
     * matching the keys produced by {@see emptyDailyMap()}. Driver-aware:
     * Postgres to_char / MySQL date_format / SQLite strftime.
     */
    public static function dayBucket(string $column): string
    {
        return match (self::driver()) {
            'pgsql' => "to_char({$column}, 'YYYY-MM-DD')",
            'sqlite' => "strftime('%Y-%m-%d', {$column})",
            default => "date_format({$column}, '%Y-%m-%d')", // mysql / mariadb
        };
    }

    /**
     * SQL expression: hour-of-day (0-23) of a UTC datetime column converted to
     * Asia/Manila (UTC+8, no DST — a fixed numeric offset, so MySQL's named
     * time-zone tables are not required). Driver-aware.
     */
    public static function manilaHour(string $column): string
    {
        return match (self::driver()) {
            'pgsql' => "extract(hour from ({$column} at time zone 'UTC') at time zone 'Asia/Manila')",
            'sqlite' => "cast(strftime('%H', datetime({$column}, '+8 hours')) as integer)",
            default => "hour(convert_tz({$column}, '+00:00', '+08:00'))", // mysql / mariadb
        };
    }

    /**
     * SQL expression: whole minutes elapsed from $from to $to (i.e. $to - $from),
     * for averaging a duration. Driver-aware.
     */
    public static function minutesBetween(string $from, string $to): string
    {
        return match (self::driver()) {
            'pgsql' => "extract(epoch from ({$to} - {$from})) / 60",
            'sqlite' => "(julianday({$to}) - julianday({$from})) * 1440",
            default => "timestampdiff(second, {$from}, {$to}) / 60", // mysql / mariadb
        };
    }

    private static function driver(): string
    {
        return DB::connection()->getDriverName();
    }
}
