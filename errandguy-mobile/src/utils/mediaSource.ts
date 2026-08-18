import { secureStorage } from './storage';
import { resolveImageUrl } from './resolveImageUrl';

/**
 * Build a React Native <Image> `source` for an API-served image URL.
 *
 * Booking media (chat images, receipt/pickup/delivery/completion photos) and
 * runner KYC documents are served from PRIVATE, participant-gated routes
 * (`/internal/media/...`, `/internal/runner-documents/...`) that require the
 * Sanctum bearer token. RN's <Image> does NOT send the app's axios auth header,
 * so those URLs would 403 and never render. Attach the bearer for exactly those
 * gated routes; public avatars, absolute external URLs, and local previews
 * (file://, content://, data:, blob:) pass through header-free.
 *
 * The token is read from the SYNCHRONOUS in-memory cache (the same one the axios
 * request interceptor peeks) so it's available at render time.
 */
export function mediaSource(
  url: string | null | undefined,
): { uri: string; headers?: Record<string, string> } | undefined {
  const resolved = resolveImageUrl(url);
  if (!resolved) return undefined;

  // Only the gated internal routes need auth.
  if (!/\/internal\/(media|runner-documents)\//.test(resolved)) {
    return { uri: resolved };
  }

  const token = secureStorage.peek('auth_token');
  return token
    ? { uri: resolved, headers: { Authorization: `Bearer ${token}` } }
    : { uri: resolved };
}
