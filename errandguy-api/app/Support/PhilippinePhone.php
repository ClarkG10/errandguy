<?php

namespace App\Support;

/**
 * Philippine mobile numbers. Accepts +639…, 639…, 09… and 9…, with spaces,
 * dashes, dots or brackets in between; anything else is not a PH mobile
 * number (null).
 *
 * Two shapes come out:
 *   - canonical(): +639XXXXXXXXX — how every phone is STORED and LOOKED UP
 *     (accounts, trusted contacts, errand contacts), so "0917…" and "+63917…"
 *     are one number;
 *   - normalize(): 09XXXXXXXXX — what the SMS provider is sent.
 */
final class PhilippinePhone
{
    public static function canonical(?string $number): ?string
    {
        $subscriber = self::subscriber($number);

        return $subscriber === null ? null : '+63'.$subscriber;
    }

    public static function normalize(?string $number): ?string
    {
        $subscriber = self::subscriber($number);

        return $subscriber === null ? null : '0'.$subscriber;
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

    /** The ten digits after the country code / trunk prefix ("9171234567"). */
    private static function subscriber(?string $number): ?string
    {
        if ($number === null) {
            return null;
        }

        $digits = preg_replace('/[\s\-().]/', '', trim($number)) ?? '';

        return preg_match('/^(?:\+?63|0)?(9\d{9})$/', $digits, $m) === 1 ? $m[1] : null;
    }
}
