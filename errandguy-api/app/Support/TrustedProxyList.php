<?php

namespace App\Support;

/**
 * The proxies whose X-Forwarded-For / X-Forwarded-Proto the app believes,
 * read from config('trustedproxy.proxies') — i.e. the TRUSTED_PROXIES env
 * value, which survives `config:cache` because it is read in a config file,
 * never with env() at request time.
 *
 * Accepts a comma-separated list of IPs / CIDR ranges and the keyword
 * "cloudflare", which expands to Cloudflare's published edge ranges. Empty
 * means trust nobody: forwarded headers are ignored and ip() is the address
 * that connected. '*' is refused (nginx appends X-Forwarded-For, so trusting
 * every hop lets any client choose its own IP).
 */
final class TrustedProxyList
{
    /**
     * Cloudflare's edge ranges, from https://www.cloudflare.com/ips-v4 and
     * /ips-v6 (checked 2026-10). Cloudflare changes them rarely and announces
     * changes; list the new ranges explicitly in TRUSTED_PROXIES if it does.
     */
    public const CLOUDFLARE = [
        '173.245.48.0/20',
        '103.21.244.0/22',
        '103.22.200.0/22',
        '103.31.4.0/22',
        '141.101.64.0/18',
        '108.162.192.0/18',
        '190.93.240.0/20',
        '188.114.96.0/20',
        '197.234.240.0/22',
        '198.41.128.0/17',
        '162.158.0.0/15',
        '104.16.0.0/13',
        '104.24.0.0/14',
        '172.64.0.0/13',
        '131.0.72.0/22',
        '2400:cb00::/32',
        '2606:4700::/32',
        '2803:f800::/32',
        '2405:b500::/32',
        '2405:8100::/32',
        '2a06:98c0::/29',
        '2c0f:f248::/32',
    ];

    /** @return array<int, string> */
    public static function configured(): array
    {
        return self::parse(config('trustedproxy.proxies'));
    }

    /** @return array<int, string> */
    public static function parse(mixed $raw): array
    {
        $entries = is_array($raw) ? $raw : explode(',', (string) $raw);

        $proxies = [];
        foreach ($entries as $entry) {
            $entry = trim((string) $entry);
            if ($entry === '' || $entry === '*' || $entry === '**') {
                continue;
            }
            if (strtolower($entry) === 'cloudflare') {
                array_push($proxies, ...self::CLOUDFLARE);

                continue;
            }
            $proxies[] = $entry;
        }

        return array_values(array_unique($proxies));
    }
}
