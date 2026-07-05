import { Linking } from 'react-native';

/**
 * Open an external URL (e.g. a Xendit hosted checkout page).
 *
 * `expo-web-browser` gives a nicer in-app browser, but its native module
 * ("ExpoWebBrowser") is only present in a custom dev/EAS build. In Expo Go —
 * or a dev build made before the package was added — a STATIC top-level
 * `import * as WebBrowser from 'expo-web-browser'` throws "Cannot find native
 * module 'ExpoWebBrowser'" at module-load time and crashes the whole screen.
 *
 * So we load it lazily inside a try/catch and fall back to React Native's
 * built-in `Linking.openURL`, which requires no extra native module and opens
 * the system browser. Payment still completes; the wallet/booking is settled
 * by the Xendit webhook regardless of which browser was used.
 *
 * @returns true if a browser was opened, false if the URL could not be opened.
 */
export async function openCheckoutUrl(url: string): Promise<boolean> {
  try {
    // Lazy require so a missing native module is caught here instead of
    // crashing at import time.
    const WebBrowser = require('expo-web-browser');
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
