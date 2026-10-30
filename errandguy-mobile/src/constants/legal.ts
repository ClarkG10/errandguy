/**
 * The version of the Terms of Service / Privacy Policy currently shown at
 * registration. Sent to the API on sign-up (PRIV-2) so the platform can record
 * exactly which policy the user consented to (DPA accountability). Bump this
 * whenever the terms/privacy copy (settings/terms.tsx, components/auth/LegalModal.tsx)
 * materially changes.
 */
export const PRIVACY_POLICY_VERSION = '2026-10-31';

/**
 * A public web page served by the API host ({APP_URL}/terms, /privacy,
 * /delete-account), built from the API base URL so it follows whichever
 * backend this build talks to: "https://api.example.com/api/v1" →
 * "https://api.example.com/terms".
 */
export function publicPageUrl(
  path: string,
  apiUrl: string = process.env.EXPO_PUBLIC_API_URL ?? '',
): string {
  const page = path.startsWith('/') ? path : `/${path}`;
  try {
    const u = new URL(apiUrl);
    return `${u.protocol}//${u.host}${page}`;
  } catch {
    return `${apiUrl.replace(/\/api(\/.*)?$/, '').replace(/\/+$/, '')}${page}`;
  }
}

/** The full Terms of Service. */
export const TERMS_URL = publicPageUrl('/terms');

/** The full Privacy Policy. */
export const PRIVACY_URL = publicPageUrl('/privacy');

/**
 * The page that explains account deletion and lets someone ask for it without
 * the app (Google Play requires one).
 */
export const DELETE_ACCOUNT_URL = publicPageUrl('/delete-account');

export type PublicPage = 'terms' | 'privacy' | 'deleteAccount';

/** Each public page with the label every surface links it by. */
export const PUBLIC_PAGES: Record<PublicPage, { label: string; url: string }> = {
  terms: { label: 'Terms of Service', url: TERMS_URL },
  privacy: { label: 'Privacy Policy', url: PRIVACY_URL },
  deleteAccount: { label: 'Delete your account', url: DELETE_ACCOUNT_URL },
};
