/**
 * Normalize an image URL coming from the API. Laravel's `Storage::url()`
 * relies on the configured `APP_URL` — if that's mis-set to localhost
 * (or the response was generated under a different host) the URL will
 * be unreachable from a real device. We absolutize anything that looks
 * relative against the API origin so chat images render regardless.
 */
function originOf(raw: string): string {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return raw.replace(/\/api\/.*/, '');
  }
}

let cachedOrigin: { raw: string; origin: string } | null = null;

/** The API's origin ("https://host[:port]"), or '' when it isn't configured. */
export function apiOrigin(): string {
  const raw = process.env.EXPO_PUBLIC_API_URL ?? '';
  if (cachedOrigin === null || cachedOrigin.raw !== raw) {
    cachedOrigin = { raw, origin: originOf(raw) };
  }
  return cachedOrigin.origin;
}

/**
 * True only for a URL on the API's own origin — same scheme, host and port,
 * and no user-info part. A text check on the path or a prefix match is not
 * enough: "https://<api-host>.evil.tld/…" and "https://<api-host>@evil.tld/…"
 * both start like ours and point somewhere else.
 */
export function isApiOriginUrl(url: string): boolean {
  const origin = apiOrigin();
  if (!origin) return false;
  const m = /^(https?):\/\/([^/?#]*)/i.exec(url);
  if (!m || m[2].includes('@')) return false;
  return `${m[1]}://${m[2]}`.toLowerCase() === origin.toLowerCase();
}

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
    const origin = apiOrigin();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url) && origin) {
      const path = url.replace(/^https?:\/\/[^/]+/i, '');
      return `${origin}${path}`;
    }
    return url;
  }
  // Relative path — anchor against the API origin.
  const origin = apiOrigin();
  if (!origin) return url;
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${origin}${path}`;
}
