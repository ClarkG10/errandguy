<?php

namespace App\Support;

use Illuminate\Support\Carbon;

/**
 * Calendar days in the business timezone (Manila), for "today" figures and
 * day-by-day counts. The app and the database stay in UTC, so a Manila day is
 * the UTC range [16:00 the day before, 16:00).
 */
final class BusinessDay
{
    public static function timezone(): string
    {
        return (string) config('app.business_timezone', 'Asia/Manila');
    }

    /** Midnight in Manila at the start of today (minus $daysAgo days), as a UTC instant. */
    public static function start(int $daysAgo = 0): Carbon
    {
        return now(self::timezone())->startOfDay()->subDays($daysAgo)->utc();
    }

    /** Midnight in Manila at the start of tomorrow, as a UTC instant. */
    public static function endOfToday(): Carbon
    {
        return self::start()->addDay();
    }

    /** Today's Manila date minus $daysAgo days, as 'YYYY-MM-DD'. */
    public static function date(int $daysAgo = 0): string
    {
        return now(self::timezone())->startOfDay()->subDays($daysAgo)->toDateString();
    }

    /** Midnight in Manila at the start of a 'YYYY-MM-DD' date, as a UTC instant. */
    public static function startOf(string $date): Carbon
    {
        return Carbon::parse($date, self::timezone())->startOfDay()->utc();
    }
}
