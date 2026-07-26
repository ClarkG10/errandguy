import { AppState } from 'react-native';
import { supabase } from './supabase';
import api from './api';

/**
 * Authenticate the Supabase Realtime client as the logged-in user so
 * `postgres_changes` subscriptions run as role=authenticated (RLS-scoped to the
 * user) instead of `anon`. The anon role is what currently gates realtime
 * delivery — with it, subscriptions connect but receive nothing, so the app
 * lives on its polling fallbacks (audit P6).
 *
 * INERT BY DEFAULT: the backend `/realtime-token` endpoint returns
 * `{ token: null }` until SUPABASE_JWT_SECRET is configured AND the RLS policies
 * in errandguy-api/docs/supabase-realtime-p6.md are applied. While the token is
 * null this is a NO-OP, so realtime behaves exactly as it does today
 * (anon → polling) — zero regression. Never throws.
 */

let lastToken: string | null = null;
let appStateSubscribed = false;

// Register a single foreground listener (idempotent) so the short-lived token
// is renewed when the app resumes — set up lazily on the first call so this
// module has no side effects until realtime auth is actually attempted.
function ensureForegroundRefresh(): void {
  if (appStateSubscribed) return;
  appStateSubscribed = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void refreshRealtimeAuth();
  });
}

export async function refreshRealtimeAuth(): Promise<void> {
  ensureForegroundRefresh();
  try {
    const res = await api.get('/realtime-token', { silent: true, noCache: true } as any);
    const token: string | null = res.data?.data?.token ?? null;
    // Only touch the realtime client when the backend actually issued a token.
    // With the feature disabled (token null) we never call setAuth, so realtime
    // stays anon exactly as before.
    if (token && token !== lastToken) {
      lastToken = token;
      supabase.realtime.setAuth(token);
    }
  } catch {
    // Best-effort — on any failure leave realtime as-is. No regression.
  }
}

/** Reset realtime auth back to anon (e.g. on logout). No-op if never set. */
export function clearRealtimeAuth(): void {
  if (lastToken == null) return;
  lastToken = null;
  try {
    supabase.realtime.setAuth(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '');
  } catch {
    /* best-effort */
  }
}
