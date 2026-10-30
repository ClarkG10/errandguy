/**
 * The version of the Terms of Service / Privacy Policy currently shown at
 * registration. Sent to the API on sign-up (PRIV-2) so the platform can record
 * exactly which policy the user consented to (DPA accountability). Bump this
 * whenever the terms/privacy copy (settings/terms.tsx, components/auth/LegalModal.tsx)
 * materially changes.
 */
export const PRIVACY_POLICY_VERSION = '2026-10-31';

/**
 * The public page that explains account deletion and lets someone ask for it
 * without the app (Google Play requires one). Served by the API host at
 * {APP_URL}/delete-account, so it follows whichever backend this build talks to.
 */
export const DELETE_ACCOUNT_URL = (() => {
  const api = process.env.EXPO_PUBLIC_API_URL ?? '';
  try {
    const u = new URL(api);
    return `${u.protocol}//${u.host}/delete-account`;
  } catch {
    return `${api.replace(/\/api\/.*$/, '')}/delete-account`;
  }
})();
