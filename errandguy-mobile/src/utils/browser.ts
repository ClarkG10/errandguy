import { Linking } from 'react-native';

/**
 * Custom-scheme deep link the in-app payment sheet watches for.
 *
 * Xendit only accepts https `success_redirect_url`s, and iOS's
 * ASWebAuthenticationSession only auto-closes on a CUSTOM scheme. So the API
 * sets Xendit's redirect to an https bridge page (…/payment/complete) that
 * instantly forwards the browser to THIS url; the sheet then intercepts it and
 * closes automatically. Must match the scheme in app.json and the redirect in
 * the API's bridge page.
 */
export const PAYMENT_RETURN_URL = 'errandguy://payment-complete';

/**
 * Open a Xendit hosted checkout URL as a seamless, auto-returning in-app sheet.
 *
 * Order of preference:
 *  1. `openAuthSessionAsync(url, returnUrl)` — an in-app browser sheet
 *     (SFSafariViewController / Chrome Custom Tabs) that CLOSES ITSELF the
 *     moment the checkout redirects (via the API bridge page) to
 *     `returnUrl` after success — no manual "Done" tap, no external browser.
 *  2. `openBrowserAsync(url)` — plain in-app sheet (user closes it manually)
 *     when no returnUrl is supplied.
 *  3. `Linking.openURL(url)` — system browser, only if the expo-web-browser
 *     native module isn't present (Expo Go / a dev build made before it was
 *     added). Guarded so a missing module degrades instead of crashing.
 *
 * Payment still settles via the Xendit webhook regardless of which path ran.
 *
 * @returns true if a browser/sheet was opened, false if the URL couldn't open.
 */
export async function openCheckoutUrl(url: string, returnUrl?: string): Promise<boolean> {
  try {
    // Lazy require so a missing native module is caught here instead of
    // crashing at import time.
    const WebBrowser = require('expo-web-browser');
    if (returnUrl) {
      const result = await WebBrowser.openAuthSessionAsync(url, returnUrl, {
        showInRecents: false,
      });
      // 'success' = redirected to returnUrl; 'cancel'/'dismiss' = user closed.
      // In every case control is back in the app, which is what we want.
      return result?.type !== 'locked';
    }
    await WebBrowser.openBrowserAsync(url);
    return true;
  } catch {
    // Native module unavailable (or open failed) — fall back to Linking.
  }

  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
