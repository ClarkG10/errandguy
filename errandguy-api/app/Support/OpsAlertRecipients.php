<?php

namespace App\Support;

use App\Models\SystemConfig;

/**
 * Who staff alerts reach outside the admin panel. Staff set both lists under
 * System → System configs:
 *
 *   - ops_alert_emails — emailed the moment someone presses SOS, and sent the
 *     ops digest;
 *   - ops_alert_phone  — texted the moment someone presses SOS.
 *
 * Both are comma-separated; invalid entries are dropped. An empty list sends
 * nothing.
 */
final class OpsAlertRecipients
{
    public const EMAILS_KEY = 'ops_alert_emails';

    public const PHONES_KEY = 'ops_alert_phone';

    /**
     * Resolution order, first non-empty wins:
     *   1. system_config ops_alert_emails (set in the admin panel);
     *   2. the older system_config admin_alert_email;
     *   3. config('mail.admin_alert_address') / env ADMIN_ALERT_EMAIL.
     *
     * @return array<int,string>
     */
    public static function emails(): array
    {
        $raw = self::setting(self::EMAILS_KEY);
        if (blank($raw)) {
            $raw = self::setting('admin_alert_email');
        }
        if (blank($raw)) {
            $raw = config('mail.admin_alert_address') ?: env('ADMIN_ALERT_EMAIL');
        }

        return self::emailList(is_string($raw) ? $raw : null);
    }

    /** @return array<int,string> numbers in 09XXXXXXXXX form */
    public static function phones(): array
    {
        return PhilippinePhone::list(self::setting(self::PHONES_KEY));
    }

    /** @return array<int,string> */
    public static function emailList(?string $csv): array
    {
        if ($csv === null || trim($csv) === '') {
            return [];
        }

        $emails = [];
        foreach (explode(',', $csv) as $candidate) {
            $candidate = trim($candidate);
            if ($candidate !== '' && filter_var($candidate, FILTER_VALIDATE_EMAIL)) {
                $emails[] = $candidate;
            }
        }

        return array_values(array_unique($emails));
    }

    private static function setting(string $key): ?string
    {
        try {
            return SystemConfig::getValue($key);
        } catch (\Throwable) {
            // Table missing / DB unreachable — treat as not configured.
            return null;
        }
    }
}
