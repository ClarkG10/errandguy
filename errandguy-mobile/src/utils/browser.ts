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
 * Resolve expo-web-browser ONCE, at import, inside a guard.
 *
 * Its native module ("ExpoWebBrowser") only exists in a dev/EAS build that was
 * compiled AFTER the package was added. In Expo Go or an older dev client the
 * `require` throws "Cannot find native module 'ExpoWebBrowser'". Doing it here
 * (not per-call) means that throw is contained exactly once and the rest of the
 * app transparently falls back to the system browser — a call site can never
 * trip an uncaught error.
 */
let WebBrowser: typeof import('expo-web-browser') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  WebBrowser = require('expo-web-browser');
} catch {
  WebBrowser = null;
}

/** True when the in-app browser sheet is available in this build. */
export const hasInAppBrowser = WebBrowser != null;

/**
 * Open a Xendit hosted checkout URL.
 *
 * Preference order:
 *  1. `openAuthSessionAsync(url, returnUrl)` — in-app sheet
 *     (SFSafariViewController / Chrome Custom Tabs) that CLOSES ITSELF when the
 *     checkout redirects (via the API bridge page) to `returnUrl` after
 *     success. The seamless flow — needs the native module (a proper build).
 *  2. `openBrowserAsync(url)` — plain in-app sheet, no return URL.
 *  3. `Linking.openURL(url)` — system browser. Always available (React Native
 *     core), so payment still works even when the native module is missing;
 *     it just isn't the in-app sheet.
 *
 * Payment settles via the Xendit webhook regardless of which path ran.
 *
 * @returns true if a browser/sheet opened, false if the URL couldn't open.
 */
export async function openCheckoutUrl(url: string, returnUrl?: string): Promise<boolean> {
  if (WebBrowser) {
    try {
      if (returnUrl) {
        const result = await WebBrowser.openAuthSessionAsync(url, returnUrl, {
          showInRecents: false,
        });
        // 'success' = redirected to returnUrl; 'cancel'/'dismiss' = user
        // closed. In every case control is back in the app — what we want.
        return result?.type !== 'locked';
      }
      await WebBrowser.openBrowserAsync(url);
      return true;
    } catch {
      // Sheet failed at runtime — fall back to the system browser below.
    }
  }

  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
