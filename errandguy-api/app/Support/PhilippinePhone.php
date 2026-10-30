<?php

namespace App\Support;

/**
 * Philippine mobile numbers in the one shape the SMS provider is sent:
 * 09XXXXXXXXX. Accepts +639…, 639…, 09… and 9…, with spaces, dashes, dots or
 * brackets in between; anything else is not a PH mobile number (null).
 */
final class PhilippinePhone
{
    public static function normalize(?string $number): ?string
    {
        if ($number === null) {
            return null;
        }

        $digits = preg_replace('/[\s\-().]/', '', trim($number)) ?? '';

        if (preg_match('/^(?:\+?63|0)?(9\d{9})$/', $digits, $m) !== 1) {
            return null;
        }

        return '0'.$m[1];
    }

    /**
     * A comma-separated list of numbers, normalised, de-duplicated, invalid
     * entries dropped.
     *
     * @return array<int,string>
     */
    public static function list(?string $csv): array
    {
        if ($csv === null || trim($csv) === '') {
            return [];
        }

        $numbers = [];
        foreach (explode(',', $csv) as $candidate) {
            $normalised = self::normalize($candidate);
            if ($normalised !== null) {
                $numbers[] = $normalised;
            }
        }

        return array_values(array_unique($numbers));
    }
}
