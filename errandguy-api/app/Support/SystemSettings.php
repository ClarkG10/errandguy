<?php

namespace App\Support;

use App\Console\Commands\DetectStalledErrandsCommand;
use Closure;

/**
 * Every system_config setting the code reads, with the value it falls back to,
 * the values staff may set, and a plain description.
 *
 * The admin panel only lets staff edit keys listed here, and only to a value
 * that passes the key's check — so a typo can't zero the platform fee or stop
 * matching. A key nothing reads isn't listed, so it can't be edited or added.
 * The settings data migration creates any listed row that is missing, with the
 * default below.
 *
 * Types:
 *   - number:  a peso/percent/km amount, up to 2 decimals, between min and max;
 *   - integer: a whole number between min and max (with `zero_off`, 0 is also
 *              allowed and switches the check off);
 *   - switch:  on (1) or off (0);
 *   - emails / phones: a comma-separated list, may be left empty;
 *   - managed: changed on its own page (named in its description), never here.
 */
final class SystemSettings
{
    public const NUMBER = 'number';

    public const INTEGER = 'integer';

    public const SWITCH = 'switch';

    public const EMAILS = 'emails';

    public const PHONES = 'phones';

    public const MANAGED = 'managed';

    /** Statuses the stall monitor watches; its default minutes live in DetectStalledErrandsCommand. */
    private const STALL_LABELS = [
        'accepted' => 'Accepted',
        'heading_to_pickup' => 'Heading to pickup',
        'arrived_at_pickup' => 'Arrived at pickup',
        'picked_up' => 'Picked up',
        'in_transit' => 'In transit',
        'arrived_at_dropoff' => 'Arrived at dropoff',
        'delivered' => 'Delivered, not yet completed',
    ];

    private const DEFINITIONS = [
        // ── Money ──
        'platform_fee_percent' => [
            'label' => 'Platform fee (%)',
            'type' => self::NUMBER, 'default' => '15', 'min' => 1, 'max' => 50,
            'description' => 'ErrandGuy’s share of each errand’s price, in percent. The runner gets the rest.',
        ],
        'multi_stop_fee' => [
            'label' => 'Extra stop fee (₱)',
            'type' => self::NUMBER, 'default' => '15', 'min' => 0, 'max' => 500,
            'description' => 'Added to the price for each extra stop on an errand, in pesos. 0 makes extra stops free.',
        ],
        'min_payout_amount' => [
            'label' => 'Smallest runner payout (₱)',
            'type' => self::NUMBER, 'default' => '100', 'min' => 1, 'max' => 10000,
            'description' => 'The least a runner can cash out at one time, in pesos.',
        ],
        'runner_cash_debt_limit' => [
            'label' => 'Runner cash-fee limit (₱)',
            'type' => self::NUMBER, 'default' => '1000', 'min' => 0, 'max' => 20000,
            'description' => 'How much a runner can owe ErrandGuy in fees from cash errands before they stop getting cash errands, in pesos. 0 turns the limit off.',
        ],
        'shopping_budget_max' => [
            'label' => '“Buy for me” limit (₱)',
            'type' => self::NUMBER, 'default' => '3000', 'min' => 100, 'max' => 50000,
            'description' => 'Most a runner can pay for a customer’s “Buy for me” items, in pesos. The customer repays it in cash at the door.',
        ],
        'admin_adjustment_daily_cap' => [
            'label' => 'Daily limit on money staff move by hand (₱)',
            'type' => self::NUMBER, 'default' => '20000', 'min' => 1000, 'max' => 1000000,
            'description' => 'The most one staff member can move by hand in one day (Manila time), in pesos: wallet credits and debits plus “Pay a runner” payouts, added together.',
        ],
        'admin_adjustment_alert_threshold' => [
            'label' => 'Alert on a hand-made money move from (₱)',
            'type' => self::NUMBER, 'default' => '5000', 'min' => 100, 'max' => 100000,
            'description' => 'A single wallet adjustment or “Pay a runner” payout of this many pesos or more puts an alert on the dashboard for money staff.',
        ],

        // ── Matching ──
        'matching_radius_km' => [
            'label' => 'Runner search radius (km)',
            'type' => self::NUMBER, 'default' => '10', 'min' => 1, 'max' => 50,
            'description' => 'How far from the pickup to look for runners first, in kilometres. Later search rounds widen it (1.75×, then 2.5×).',
        ],
        'matching_retry_attempts' => [
            'label' => 'Search rounds',
            'type' => self::INTEGER, 'default' => '3', 'min' => 1, 'max' => 3,
            'description' => 'How many rounds of searching an errand booked for now gets, each over a wider area. 1 to 3.',
        ],
        'matching_retry_delay_seconds' => [
            'label' => 'Wait between search rounds (seconds)',
            'type' => self::INTEGER, 'default' => '45', 'min' => 5, 'max' => 600,
            'description' => 'How long to wait before the next, wider search round.',
        ],
        'matching_max_offers' => [
            'label' => 'Runners offered per round',
            'type' => self::INTEGER, 'default' => '5', 'min' => 1, 'max' => 20,
            'description' => 'How many runners, one after another, are offered an errand in one search round before it counts as “no runner”.',
        ],
        'matched_acceptance_timeout_seconds' => [
            'label' => 'Time a runner has to accept (seconds)',
            'type' => self::INTEGER, 'default' => '90', 'min' => 30, 'max' => 600,
            'description' => 'How long a runner has to accept an offered errand before it goes to someone else.',
        ],
        'auto_cancel_timeout_minutes' => [
            'label' => 'Stop searching after (minutes)',
            'type' => self::INTEGER, 'default' => '30', 'min' => 5, 'max' => 180,
            'description' => 'How long to look for a runner for an errand booked for now before telling the customer no one was found and refunding them.',
        ],
        'retry_auto_cancel_timeout_minutes' => [
            'label' => 'Stop a “Search again” after (minutes)',
            'type' => self::INTEGER, 'default' => '5', 'min' => 1, 'max' => 60,
            'description' => 'How long a customer’s “Search again” keeps looking before giving up.',
        ],

        // ── Staff alerts ──
        'ops_alert_emails' => [
            'label' => 'Ops alert emails',
            'type' => self::EMAILS, 'default' => '',
            'description' => 'Email addresses (separate with commas) that get an email the moment someone presses SOS, and the ops digest. Leave empty to send none.',
        ],
        'ops_alert_phone' => [
            'label' => 'Ops alert phone numbers',
            'type' => self::PHONES, 'default' => '',
            'description' => 'Mobile numbers (separate with commas, e.g. 09171234567) that get a text the moment someone presses SOS. Needs the SMS service to be set up. Leave empty to send none.',
        ],
        'admin_alert_email' => [
            'label' => 'Older ops digest email',
            'type' => self::EMAILS, 'default' => '',
            'description' => 'Older single address for the ops digest. Used only while “Ops alert emails” is empty.',
        ],
        'admin_alert_throttle_hours' => [
            'label' => 'Hours between repeat digest emails',
            'type' => self::INTEGER, 'default' => '6', 'min' => 1, 'max' => 168,
            'description' => 'How long the ops digest waits before emailing again about the same overdue queue.',
        ],
        'stall_alert_enabled' => [
            'label' => 'Watch for stalled errands',
            'type' => self::SWITCH, 'default' => '1',
            'description' => 'Raise a dashboard alert when an errand stops moving for longer than the times below.',
        ],

        // ── Changed on their own page ──
        'enabled_payment_methods' => [
            'label' => 'Payment methods offered',
            'type' => self::MANAGED, 'default' => 'wallet,gcash,maya,cash',
            'description' => 'Which ways to pay customers see. Change it on Money → Platform payment methods.',
        ],
    ];

    /** @return array<string, array<string, mixed>> */
    public static function all(): array
    {
        $all = self::DEFINITIONS;

        foreach (DetectStalledErrandsCommand::DEFAULT_THRESHOLDS as $status => $minutes) {
            $label = self::STALL_LABELS[$status] ?? $status;
            $all["stall_alert_minutes_{$status}"] = [
                'label' => "Stalled at “{$label}” after (minutes)",
                'type' => self::INTEGER, 'default' => (string) $minutes, 'min' => 5, 'max' => 1440, 'zero_off' => true,
                'description' => "Alert staff when an errand sits at “{$label}” this many minutes (5 to 1440). 0 turns this check off.",
            ];
        }

        return $all;
    }

    /** @return array<string, mixed>|null */
    public static function get(string $key): ?array
    {
        return self::all()[$key] ?? null;
    }

    public static function isKnown(?string $key): bool
    {
        return $key !== null && self::get($key) !== null;
    }

    /** Known, and edited in the settings list (not on a page of its own). */
    public static function isEditable(?string $key): bool
    {
        $definition = $key !== null ? self::get($key) : null;

        return $definition !== null && $definition['type'] !== self::MANAGED;
    }

    public static function type(string $key): ?string
    {
        return self::get($key)['type'] ?? null;
    }

    public static function label(string $key): string
    {
        return self::get($key)['label'] ?? $key;
    }

    public static function description(string $key): ?string
    {
        return self::get($key)['description'] ?? null;
    }

    public static function blankAllowed(string $key): bool
    {
        return in_array(self::type($key), [self::EMAILS, self::PHONES], true);
    }

    /** One line saying what may be entered, for the edit form. */
    public static function allowedHint(string $key): ?string
    {
        $d = self::get($key);
        if ($d === null) {
            return null;
        }

        return match ($d['type']) {
            self::NUMBER => 'Allowed: '.self::fmt($d['min'], true).' to '.self::fmt($d['max'], true).', up to 2 decimals.',
            self::INTEGER => 'Allowed: a whole number from '.self::fmt($d['min'], true).' to '.self::fmt($d['max'], true)
                .(! empty($d['zero_off']) ? ', or 0 to turn it off.' : '.'),
            self::SWITCH => 'On or off.',
            self::EMAILS => 'Email addresses separated by commas, or empty.',
            self::PHONES => 'Philippine mobile numbers separated by commas, or empty.',
            default => null,
        };
    }

    /**
     * The value as stored: trimmed, list entries tidied, numbers without
     * stray leading zeros.
     */
    public static function normalize(string $key, ?string $value): string
    {
        $value = trim((string) $value);

        return match (self::type($key)) {
            self::EMAILS, self::PHONES => implode(', ', self::entries($value)),
            self::INTEGER => preg_match('/^\d+$/', $value) ? (string) (int) $value : $value,
            self::NUMBER => preg_match('/^\d+(\.\d{1,2})?$/', $value) ? self::fmt((float) $value) : $value,
            default => $value,
        };
    }

    /**
     * Validation for a key's value, as Laravel closure rules. An unknown or
     * page-managed key accepts nothing, so it can't be changed here.
     *
     * @return array<int, Closure>
     */
    public static function rules(?string $key): array
    {
        $d = $key !== null ? self::get($key) : null;

        return [function (string $attribute, mixed $value, Closure $fail) use ($key, $d): void {
            $message = $d === null || $d['type'] === self::MANAGED
                ? 'This setting can’t be changed here.'
                : self::problem($key, $d, is_scalar($value) || $value === null ? trim((string) $value) : null);

            if ($message !== null) {
                $fail($message);
            }
        }];
    }

    /** What is wrong with $value for this setting, or null when it is fine. */
    public static function problem(string $key, array $d, ?string $value): ?string
    {
        if ($value === null) {
            return 'Enter a value.';
        }

        switch ($d['type']) {
            case self::NUMBER:
                $range = self::fmt($d['min'], true).' and '.self::fmt($d['max'], true);
                if (! preg_match('/^\d+(\.\d{1,2})?$/', $value)) {
                    return "Enter a number between {$range} (digits only, up to 2 decimals).";
                }
                if ((float) $value < $d['min'] || (float) $value > $d['max']) {
                    return "Enter a number between {$range}.";
                }

                return null;

            case self::INTEGER:
                $range = self::fmt($d['min'], true).' and '.self::fmt($d['max'], true);
                $orOff = ! empty($d['zero_off']) ? ', or 0 to turn it off' : '';
                if (! preg_match('/^\d+$/', $value)) {
                    return "Enter a whole number between {$range}{$orOff}.";
                }
                $n = (int) $value;
                if ($n === 0 && ! empty($d['zero_off'])) {
                    return null;
                }
                if ($n < $d['min'] || $n > $d['max']) {
                    return "Enter a whole number between {$range}{$orOff}.";
                }

                return null;

            case self::SWITCH:
                return in_array($value, ['0', '1'], true) ? null : 'Choose on or off.';

            case self::EMAILS:
                foreach (self::entries($value) as $entry) {
                    if (! filter_var($entry, FILTER_VALIDATE_EMAIL)) {
                        return "“{$entry}” is not an email address. Separate addresses with commas.";
                    }
                }

                return null;

            case self::PHONES:
                foreach (self::entries($value) as $entry) {
                    if (PhilippinePhone::normalize($entry) === null) {
                        return "“{$entry}” is not a Philippine mobile number (like 09171234567). Separate numbers with commas.";
                    }
                }

                return null;
        }

        return 'This setting can’t be changed here.';
    }

    /** @return array<int,string> */
    private static function entries(string $value): array
    {
        return array_values(array_filter(array_map('trim', explode(',', $value)), fn (string $e): bool => $e !== ''));
    }

    /** 1500.5 → "1500.5" (stored), or "1,500.5" when $grouped (shown to staff). */
    private static function fmt(float|int $n, bool $grouped = false): string
    {
        return rtrim(rtrim(number_format((float) $n, 2, '.', $grouped ? ',' : ''), '0'), '.');
    }
}
