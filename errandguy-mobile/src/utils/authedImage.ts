import { useAuthStore } from '../stores/authStore';

export interface AuthedImageSource {
  uri: string;
  headers?: Record<string, string>;
}

/**
 * Build an image `source` for a PRIVATE, Sanctum-protected asset — e.g. a
 * runner's KYC document, which is now served by
 * `GET /runner/documents/{id}/file` off a private disk (SEC-1) instead of a
 * public URL. The image request must carry the SAME bearer token the API
 * client sends (`Authorization: Bearer …`), or the serve route returns 401 and
 * the image fails to load. Falls back to a plain `{ uri }` when there is no
 * token (e.g. a legacy public URL viewed while signed out), and returns
 * `undefined` for an empty uri so callers can spread it directly.
 *
 * Works for both `expo-image` and React Native's `Image` (both accept
 * `source.headers`).
 */
export function authedImageSource(
  uri: string | null | undefined,
): AuthedImageSource | undefined {
  if (!uri) {
    return undefined;
  }

  const token = useAuthStore.getState().token;

  return token ? { uri, headers: { Authorization: `Bearer ${token}` } } : { uri };
}
