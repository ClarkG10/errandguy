import { useState, useCallback } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import * as Facebook from 'expo-auth-session/providers/facebook';
import { useAuth } from './useAuth';
import { toast } from '../stores/toastStore';

// Required for the OAuth popup to close and hand control back to the app.
WebBrowser.maybeCompleteAuthSession();

/**
 * Social login (Google + Facebook).
 *
 * The BACKEND is already done: POST /auth/social-login takes a provider token,
 * verifies it directly with Google (id_token → tokeninfo) / Facebook (access
 * token → graph API), then creates-or-logs-in the user. `useAuth().socialLogin`
 * wires that response into the auth store exactly like a normal login.
 *
 * This hook is the ONLY missing piece: it runs the on-device OAuth flow to
 * obtain that token, then forwards it. It works the moment the client IDs
 * below are filled in (see .env keys) — no other code changes needed.
 *
 * ── Credentials you must create ──────────────────────────────────────────────
 * GOOGLE  → Google Cloud Console → APIs & Services → Credentials → OAuth client
 *           IDs. Create THREE (Web, iOS, Android) and paste into .env:
 *             EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
 *             EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
 *             EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
 *           (Android needs the SHA-1 of your signing key; iOS needs the bundle id.)
 * FACEBOOK→ developers.facebook.com → create App → add "Facebook Login" →
 *             EXPO_PUBLIC_FACEBOOK_APP_ID
 *           Add redirect scheme `fb<APP_ID>` and `errandguy` to the allowed list.
 */
export function useSocialAuth() {
  const { socialLogin } = useAuth();
  const [loading, setLoading] = useState<null | 'google' | 'facebook'>(null);

  const [, googleResponse, googlePromptAsync] = Google.useAuthRequest({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    // We need the id_token (JWT) — that's what the backend verifies via
    // Google's tokeninfo endpoint.
    responseType: 'id_token',
    scopes: ['openid', 'profile', 'email'],
  });

  const [, fbResponse, fbPromptAsync] = Facebook.useAuthRequest({
    clientId: process.env.EXPO_PUBLIC_FACEBOOK_APP_ID,
    scopes: ['public_profile', 'email'],
  });

  const finish = useCallback(
    async (provider: 'google' | 'facebook', providerToken: string) => {
      try {
        await socialLogin(provider, providerToken);
        // Root layout redirects on auth state change — no manual nav needed.
      } catch (e: any) {
        toast.error(e?.message || `${provider} sign-in failed. Please try again.`);
      } finally {
        setLoading(null);
      }
    },
    [socialLogin],
  );

  const signInWithGoogle = useCallback(async () => {
    if (!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) {
      toast.info('Google sign-in isn’t configured yet.');
      return;
    }
    setLoading('google');
    const result = await googlePromptAsync();
    if (result?.type === 'success') {
      const idToken = result.params?.id_token ?? result.authentication?.idToken;
      if (idToken) return finish('google', idToken);
    }
    setLoading(null);
  }, [googlePromptAsync, finish]);

  const signInWithFacebook = useCallback(async () => {
    if (!process.env.EXPO_PUBLIC_FACEBOOK_APP_ID) {
      toast.info('Facebook sign-in isn’t configured yet.');
      return;
    }
    setLoading('facebook');
    const result = await fbPromptAsync();
    if (result?.type === 'success') {
      const accessToken = result.authentication?.accessToken;
      if (accessToken) return finish('facebook', accessToken);
    }
    setLoading(null);
  }, [fbPromptAsync, finish]);

  // Kept for callers that prefer reacting to the response objects.
  void googleResponse;
  void fbResponse;

  return { signInWithGoogle, signInWithFacebook, loading };
}
