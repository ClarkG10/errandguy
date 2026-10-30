import * as Notifications from 'expo-notifications';

/**
 * This phone's Expo push token, and how to let go of it at sign-out.
 *
 * useNotifications records the token when it registers; sign-out sends it to
 * the server as `device_token` (so the server stops pushing this account to a
 * phone nobody is signed in on) and then drops it here, on the device.
 */

let currentToken: string | null = null;

/** Called by useNotifications whenever the OS hands us a token. */
export function rememberPushToken(token: string | null): void {
  currentToken = token;
}

/** The token registered this session, or null (denied, simulator, not yet registered). */
export function currentPushToken(): string | null {
  return currentToken;
}

/** The OS unregister talks to FCM/APNs; a sign-out never waits longer than this on it. */
const UNREGISTER_WAIT_MS = 3_000;

/**
 * Let go of push on this phone at sign-out.
 *
 *  • Clears the previous account's notifications from the tray and the app
 *    badge — on a shared phone the next person must not read them.
 *  • Unregisters this install from push at the OS. Defence in depth: a server
 *    that ignores `device_token` would otherwise keep delivering the old
 *    account's pushes to whoever signs in next. The next sign-in registers
 *    afresh (useNotifications re-syncs when it is re-enabled).
 *
 * Never throws and never blocks sign-out for long: every step is best-effort.
 */
export async function unregisterPushLocally(): Promise<void> {
  currentToken = null;
  await Promise.allSettled([
    attempt(() => Notifications.dismissAllNotificationsAsync()),
    attempt(() => Notifications.setBadgeCountAsync(0)),
  ]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    attempt(() => Notifications.unregisterForNotificationsAsync()).catch(() => {}),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, UNREGISTER_WAIT_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

/** Run a native call as a promise — a missing module (Expo Go / web) throws synchronously. */
function attempt<T>(call: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(call());
  } catch (err) {
    return Promise.reject(err);
  }
}
