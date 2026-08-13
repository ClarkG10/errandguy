<?php

namespace App\Observability;

use Sentry\Breadcrumb;
use Sentry\Event;
use Sentry\EventHint;

/**
 * Defense-in-depth PII scrubber for Sentry events.
 *
 * Wired as the `before_send` callback in config/sentry.php (as a
 * [class, method] callable, NOT a Closure, so `config:cache` can serialize
 * it). It runs on every outgoing event and redacts values whose key looks
 * sensitive from the request payload/query string, request headers/cookies,
 * the `extra` context bag, and breadcrumb metadata.
 *
 * This is a SAFETY NET, not the primary control. The primary controls live in
 * config/sentry.php: `send_default_pii => false` (no cookies/IP, sanitized
 * headers) and `max_request_body_size => 'none'` (no request body at all).
 * The scrubber exists because breadcrumbs and `extra` context are NOT gated by
 * those flags — code that logs a phone/OTP/identifier into log context turns it
 * into a breadcrumb — and so that flipping PII on to debug can't silently start
 * leaking the well-known sensitive keys.
 */
class SentryScrubber
{
    private const REDACTED = '[Filtered]';

    private const MAX_DEPTH = 12;

    /**
     * Short / ambiguous tokens matched ONLY as a whole (normalized) key, so we
     * don't redact benign fields that merely contain the letters (e.g. "pin"
     * inside "shipping", or "ip" inside "shipping").
     *
     * @var list<string>
     */
    private const SENSITIVE_EXACT = [
        // Secrets / auth.
        'pin', 'pincode', 'otp', 'otpcode', 'cvv', 'cvc', 'cvn', 'cvv2',
        'securitycode', 'pan', 'cardnumber', 'ssn', 'iban', 'password',
        'passwd', 'pwd', 'secret', 'token', 'authorization', 'cookie', 'csrf',
        'xsrf', 'apikey', 'accesstoken', 'refreshtoken', 'privatekey',
        'clientsecret',
        // Identity / contact — these reach `extra`/breadcrumbs via app logging
        // (e.g. the OTP flow logs `identifier` + `ip`).
        'identifier', 'phoneoremail', 'mobile', 'msisdn', 'contactnumber',
        'ip', 'ipaddress', 'ipaddr', 'clientip', 'remoteaddr', 'fullname',
        'firstname', 'lastname', 'dob', 'dateofbirth',
        // Geolocation — a live-tracking app; a lat/lng in context is a person's
        // location. Kept EXACT because 'lat'/'lng' collide as substrings
        // ('lat' in 'related', 'translate', 'template').
        'lat', 'lng', 'latitude', 'longitude', 'geolocation', 'coordinates',
        // Money.
        'accountnumber', 'routingnumber', 'walletbalance',
    ];

    /**
     * Unambiguous fragments matched anywhere in the (normalized) key — these
     * do not appear in benign field names in this codebase, so matching them as
     * substrings is safe (and catches compounds like `wallet_balance_after`,
     * `email_address`, `customer_phone`).
     *
     * @var list<string>
     */
    private const SENSITIVE_CONTAINS = [
        'password', 'secret', 'token', 'authorization', 'apikey',
        'privatekey', 'clientsecret', 'cardnumber', 'phone', 'email',
        'address', 'balance',
    ];

    public static function handle(Event $event, ?EventHint $hint = null): ?Event
    {
        // The Sentry SDK does NOT wrap before_send in a try/catch
        // (Client::prepareEvent), so a throw here would both drop the event and
        // raise a secondary exception into Laravel's report pipeline. Fail open:
        // the primary controls (no body, no cookies/IP) already bound what can
        // be in the event, so keeping a partially-scrubbed event is safer than
        // blackholing all error reporting on a scrubber bug — and we surface the
        // failure so the scrubber gets fixed.
        try {
            return self::scrub($event);
        } catch (\Throwable $e) {
            error_log('SentryScrubber failed, sending event unscrubbed-past-failure: ' . $e->getMessage());

            return $event;
        }
    }

    private static function scrub(Event $event): Event
    {
        $request = $event->getRequest();

        if ($request !== []) {
            foreach (['data', 'headers', 'cookies', 'env'] as $section) {
                if (isset($request[$section]) && is_array($request[$section])) {
                    $request[$section] = self::redact($request[$section]);
                }
            }

            // query_string is attached unconditionally by the SDK and is a
            // string ("phone=%2B63...&otp=123"). Parse, redact by key, rebuild.
            if (isset($request['query_string']) && is_string($request['query_string']) && $request['query_string'] !== '') {
                parse_str($request['query_string'], $parsed);
                $request['query_string'] = http_build_query(self::redact($parsed));
            }

            $event->setRequest($request);
        }

        $extra = $event->getExtra();

        if ($extra !== []) {
            $event->setExtra(self::redact($extra));
        }

        // Breadcrumbs are NOT gated by send_default_pii / max_request_body_size,
        // so scrub their metadata too. Our own log breadcrumbs are mostly
        // structured/ID-based (see LogApiRequests), but the OTP flow and any
        // third-party breadcrumb could carry a sensitive key.
        $breadcrumbs = $event->getBreadcrumbs();

        if ($breadcrumbs !== []) {
            $event->setBreadcrumb(array_map(
                static fn (Breadcrumb $breadcrumb): Breadcrumb => self::scrubBreadcrumb($breadcrumb),
                $breadcrumbs
            ));
        }

        return $event;
    }

    private static function scrubBreadcrumb(Breadcrumb $breadcrumb): Breadcrumb
    {
        // Breadcrumb is immutable — withMetadata() returns a new instance, so
        // fold each redaction back into $breadcrumb. withMetadata() is
        // typed `string $name` under strict_types, so guard non-string keys.
        foreach ($breadcrumb->getMetadata() as $key => $value) {
            if (! is_string($key)) {
                continue;
            }

            if (self::isSensitiveKey($key)) {
                $breadcrumb = $breadcrumb->withMetadata($key, self::REDACTED);
            } elseif (is_array($value)) {
                $breadcrumb = $breadcrumb->withMetadata($key, self::redact($value));
            }
        }

        return $breadcrumb;
    }

    /**
     * Recursively replace sensitive values with a placeholder.
     *
     * @param  array<mixed, mixed>  $data
     * @return array<mixed, mixed>
     */
    private static function redact(array $data, int $depth = 0): array
    {
        foreach ($data as $key => $value) {
            if (is_string($key) && self::isSensitiveKey($key)) {
                $data[$key] = self::REDACTED;

                continue;
            }

            if (is_array($value) && $depth < self::MAX_DEPTH) {
                $data[$key] = self::redact($value, $depth + 1);
            }
        }

        return $data;
    }

    private static function isSensitiveKey(string $key): bool
    {
        // Normalize: lowercase and drop separators so "card-number",
        // "card_number", and "cardNumber" all collapse to "cardnumber".
        $normalized = str_replace(['_', '-', ' ', '.'], '', strtolower($key));

        if (in_array($normalized, self::SENSITIVE_EXACT, true)) {
            return true;
        }

        foreach (self::SENSITIVE_CONTAINS as $fragment) {
            if (str_contains($normalized, $fragment)) {
                return true;
            }
        }

        return false;
    }
}
