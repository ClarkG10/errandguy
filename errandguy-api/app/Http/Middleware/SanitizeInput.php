<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SanitizeInput
{
    /**
     * Recursively clean every string in the request input:
     *   - strip ASCII control characters (except \t \n \r) and the
     *     C1 range, which are a common XSS / log-injection vector,
     *   - normalise stray null bytes that break PostgreSQL TEXT
     *     columns and can hide payloads from naive string filters,
     *   - trim surrounding whitespace,
     *   - reject inputs whose string length blows past a sane cap
     *     (defense in depth — individual form requests still set
     *     their own `max:` rules).
     *
     * Skipped fields: anything that looks like a password / secret
     * is left untouched so we don't silently change credentials the
     * user typed (trimming a password could lock someone out and
     * stripping a control char from a 2FA secret would corrupt it).
     * File uploads aren't strings and are ignored entirely.
     */
    private const MAX_FIELD_LENGTH = 10_000;

    private const PRESERVE_FIELDS = [
        'password',
        'password_confirmation',
        'current_password',
        'new_password',
        'token',
        'access_token',
        'refresh_token',
        'secret',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $input = $request->all();
        $cleaned = $this->sanitize($input, '');

        if ($cleaned === null) {
            return response()->json([
                'message' => 'Input field exceeds maximum allowed length.',
            ], 422);
        }

        $request->merge($cleaned);

        return $next($request);
    }

    /**
     * @return array<string,mixed>|null  null = oversize field detected
     */
    private function sanitize(array $data, string $parentKey): ?array
    {
        foreach ($data as $key => $value) {
            if (is_array($value)) {
                $cleaned = $this->sanitize($value, (string) $key);
                if ($cleaned === null) {
                    return null;
                }
                $data[$key] = $cleaned;
                continue;
            }

            if (!is_string($value)) {
                continue;
            }

            if (in_array((string) $key, self::PRESERVE_FIELDS, true)) {
                continue;
            }

            if (strlen($value) > self::MAX_FIELD_LENGTH) {
                return null;
            }

            // Strip C0 control chars (except tab/newline/carriage-return)
            // and the C1 range. \x00 is also covered by the first class.
            $clean = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/u', '', $value);
            if ($clean === null) {
                // preg_replace returns null on invalid UTF-8 — drop the
                // bytes that aren't legal UTF-8 to avoid storing garbage.
                $clean = mb_convert_encoding($value, 'UTF-8', 'UTF-8');
                $clean = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/u', '', $clean) ?? '';
            }

            $data[$key] = trim($clean);
        }

        return $data;
    }
}
