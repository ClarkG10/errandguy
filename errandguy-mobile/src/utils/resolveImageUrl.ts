/**
 * Normalize an image URL coming from the API. Laravel's `Storage::url()`
 * relies on the configured `APP_URL` — if that's mis-set to localhost
 * (or the response was generated under a different host) the URL will
 * be unreachable from a real device. We absolutize anything that looks
 * relative against the API origin so chat images render regardless.
 */
const API_ORIGIN = (() => {
  const raw = process.env.EXPO_PUBLIC_API_URL ?? '';
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return raw.replace(/\/api\/.*/, '');
  }
})();

export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // Local previews (file://, content://, data:, blob:) pass through
  // unchanged — these are runtime-only assets, never on the server.
  if (
    url.startsWith('file:') ||
    url.startsWith('content:') ||
    url.startsWith('data:') ||
    url.startsWith('blob:')
  ) {
    return url;
  }
  // Already absolute http(s) URL → use as-is.
  if (/^https?:\/\//i.test(url)) {
    // Rewrite stale localhost URLs that some dev environments emit so
    // physical devices can still load the image from the real API host.
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url) && API_ORIGIN) {
      const path = url.replace(/^https?:\/\/[^/]+/i, '');
      return `${API_ORIGIN}${path}`;
    }
    return url;
  }
  // Relative path — anchor against the API origin.
  if (!API_ORIGIN) return url;
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${API_ORIGIN}${path}`;
}
