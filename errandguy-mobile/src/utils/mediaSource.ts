import { secureStorage } from './storage';
import { apiOrigin, isApiOriginUrl, resolveImageUrl } from './resolveImageUrl';

/**
 * The private routes that need the bearer:
 *   • `/internal/media/...` — booking media (chat images, receipt / pickup /
 *     delivery / completion photos), participant-gated;
 *   • `/internal/runner-documents/...` — KYC documents as staff stream them;
 *   • `/runner/documents/{id}/file` — a runner streaming their OWN KYC
 *     document (`download_url` on RunnerDocumentResource, under /api/v1). It
 *     was missing here, so the runner's own document preview went out without
 *     the login and always failed.
 */
const GATED_PATH = /^\/internal\/(media|runner-documents)\/|\/runner\/documents\/[^/]+\/file$/;

/** An absolute http(s) URL split into its path and whatever follows it. */
const ABSOLUTE_URL = /^https?:\/\/[^/?#]*(\/[^?#]*)?([?#].*)?$/i;

/** `.` / `..` segments (plain or percent-encoded) — never carried across hosts. */
const DOT_SEGMENT = /(^|\/)(\.|%2e){1,2}(\/|$)/i;

/**
 * Build a React Native <Image> `source` for an API-served image URL.
 *
 * RN's <Image> does NOT send the app's axios auth header, so the gated routes
 * above would 401/403 and never render. Attach the bearer for exactly those;
 * public avatars, absolute external URLs, and local previews (file://,
 * content://, data:, blob:) pass through header-free.
 *
 * The token goes ONLY to the API's own origin. A gated path on any other host
 * is fetched from the API instead (same path and query): older rows hold
 * media URLs built with another host name for the same server (the server's
 * APP_URL vs the address this app calls), and those 403'd once these routes
 * needed the login. A link that merely looks like ours can therefore never
 * carry this account's token to whoever owns that other host.
 *
 * The token is read from the SYNCHRONOUS in-memory cache (the same one the axios
 * request interceptor peeks) so it's available at render time.
 */
export function mediaSource(
  url: string | null | undefined,
): { uri: string; headers?: Record<string, string> } | undefined {
  const resolved = resolveImageUrl(url);
  if (!resolved) return undefined;

  // Only the gated routes need auth, judged on the path alone — a query
  // string that mentions one doesn't count.
  const parts = ABSOLUTE_URL.exec(resolved);
  const path = parts?.[1] ?? '';
  if (!parts || !GATED_PATH.test(path)) {
    return { uri: resolved };
  }

  let uri = resolved;
  if (!isApiOriginUrl(resolved)) {
    const origin = apiOrigin();
    // Nowhere safe to send it, or a path that could climb out of the media
    // route once it's on our host: leave it as it was, without the login.
    if (!origin || DOT_SEGMENT.test(path)) return { uri: resolved };
    uri = `${origin}${path}${parts[2] ?? ''}`;
  }

  const token = secureStorage.peek('auth_token');
  return token ? { uri, headers: { Authorization: `Bearer ${token}` } } : { uri };
}
