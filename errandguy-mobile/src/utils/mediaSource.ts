import { secureStorage } from './storage';
import { resolveImageUrl } from './resolveImageUrl';

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
const GATED_MEDIA = /\/internal\/(media|runner-documents)\/|\/runner\/documents\/[^/?#]+\/file(?:[?#]|$)/;

/**
 * Build a React Native <Image> `source` for an API-served image URL.
 *
 * RN's <Image> does NOT send the app's axios auth header, so the gated routes
 * above would 401/403 and never render. Attach the bearer for exactly those;
 * public avatars, absolute external URLs, and local previews (file://,
 * content://, data:, blob:) pass through header-free.
 *
 * The token is read from the SYNCHRONOUS in-memory cache (the same one the axios
 * request interceptor peeks) so it's available at render time.
 */
export function mediaSource(
  url: string | null | undefined,
): { uri: string; headers?: Record<string, string> } | undefined {
  const resolved = resolveImageUrl(url);
  if (!resolved) return undefined;

  // Only the gated routes need auth.
  if (!GATED_MEDIA.test(resolved)) {
    return { uri: resolved };
  }

  const token = secureStorage.peek('auth_token');
  return token
    ? { uri: resolved, headers: { Authorization: `Bearer ${token}` } }
    : { uri: resolved };
}
