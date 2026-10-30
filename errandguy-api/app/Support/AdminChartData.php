<?php

namespace App\Support;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Helpers for the admin dashboard chart widgets: build a gap-filled daily axis
 * so a day with zero activity still shows as a point on the line (instead of
 * the series silently collapsing). Days are Manila calendar days
 * ({@see BusinessDay}); the app and the database store UTC, so
 * {@see dayBucket()} shifts each timestamp into Manila time before taking its
 * date, matching the keys of {@see emptyDailyMap()}.
 */
class AdminChartData
{
    /** Ordered map ['YYYY-MM-DD' => 0.0] for the last $days Manila days, oldest → newest. */
    public static function emptyDailyMap(int $days): array
    {
        $map = [];
        for ($i = $days - 1; $i >= 0; $i--) {
            $map[BusinessDay::date($i)] = 0.0;
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

    /** Manila midnight at the start of the window, as a UTC instant. */
    public static function since(int $days): Carbon
    {
        return BusinessDay::start($days - 1);
    }

    /**
     * SQL expression bucketing a UTC datetime column to its Manila 'YYYY-MM-DD'
     * date, matching the keys produced by {@see emptyDailyMap()}. Manila has no
     * daylight saving, so a fixed offset is exact and MySQL needs no time-zone
     * tables. Driver-aware.
     */
    public static function dayBucket(string $column): string
    {
        $local = now(BusinessDay::timezone());

        return match (self::driver()) {
            'pgsql' => "to_char(({$column} at time zone 'UTC') at time zone '".BusinessDay::timezone()."', 'YYYY-MM-DD')",
            'sqlite' => "strftime('%Y-%m-%d', {$column}, '".sprintf('%+d', $local->utcOffset())." minutes')",
            default => "date_format(convert_tz({$column}, '+00:00', '".$local->format('P')."'), '%Y-%m-%d')", // mysql / mariadb
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
