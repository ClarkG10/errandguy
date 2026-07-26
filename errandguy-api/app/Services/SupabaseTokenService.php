<?php

namespace App\Services;

use App\Models\User;

/**
 * Mints a short-lived Supabase-compatible JWT (HS256, signed with the project's
 * legacy JWT secret) so the mobile Supabase Realtime client can authenticate as
 * the logged-in user — role=authenticated, sub=<user id> — instead of the anon
 * role. That role is what gates `postgres_changes` delivery through RLS, so
 * without it every realtime subscription silently receives nothing and the app
 * falls back to polling (audit P6).
 *
 * INERT BY DEFAULT: returns null when SUPABASE_JWT_SECRET is not configured. The
 * client only calls `realtime.setAuth` when a non-null token comes back, so with
 * the secret unset realtime behaves EXACTLY as it does today (anon → polling).
 * Do NOT enable (set the secret) until the RLS policies in
 * docs/supabase-realtime-p6.md are applied and end-to-end delivery is verified
 * in staging — an over-broad RLS SELECT would leak PII.
 *
 * The signature uses the HS256 "legacy JWT secret" from the Supabase project
 * (Settings → API → JWT Settings). Minted server-side only — never sign on the
 * client, which would ship the secret in the app bundle.
 */
class SupabaseTokenService
{
    /**
     * @return string|null  a signed JWT, or null when realtime auth is disabled
     *                      (no secret configured)
     */
    public function mint(User $user, int $ttlSeconds = 3600): ?string
    {
        $secret = config('services.supabase.jwt_secret');
        if (empty($secret)) {
            return null;
        }

        $now = time();
        $payload = [
            'sub' => (string) $user->id,
            'role' => 'authenticated',
            'aud' => 'authenticated',
            'email' => $user->email,
            'iat' => $now,
            'exp' => $now + $ttlSeconds,
        ];

        return $this->encode(['alg' => 'HS256', 'typ' => 'JWT'], $payload, (string) $secret);
    }

    private function encode(array $header, array $payload, string $secret): string
    {
        $segments = [
            $this->base64UrlEncode(json_encode($header, JSON_UNESCAPED_SLASHES)),
            $this->base64UrlEncode(json_encode($payload, JSON_UNESCAPED_SLASHES)),
        ];
        $signingInput = implode('.', $segments);
        $signature = hash_hmac('sha256', $signingInput, $secret, true);
        $segments[] = $this->base64UrlEncode($signature);

        return implode('.', $segments);
    }

    private function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}
