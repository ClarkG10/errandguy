import { Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useNotificationStore, type PushPermission } from '../stores/notificationStore';

/**
 * The phone's notification permission, in the three states the app acts on.
 *
 * The OS prompt is a one-shot (iOS shows it once; Android 13+ twice), so it is
 * only spent when the person has said yes in the app first — see
 * components/settings/NotificationPrimer. Once it's spent and refused, only
 * the phone's Settings can turn notifications back on.
 */

type PermissionRead = { granted?: boolean; status?: string; canAskAgain?: boolean };

export function toPushPermission(read: PermissionRead | null | undefined): PushPermission {
  if (!read) return null;
  if (read.granted || read.status === 'granted') return 'granted';
  // An unknown canAskAgain is treated as askable: the request then answers.
  return read.canAskAgain === false ? 'denied' : 'undetermined';
}

/** Read the OS permission into the store. Never throws, never prompts. */
export async function readPushPermission(): Promise<PushPermission> {
  try {
    const next = toPushPermission(await Notifications.getPermissionsAsync());
    useNotificationStore.getState().setPushPermission(next);
    return next;
  } catch {
    return useNotificationStore.getState().pushPermission;
  }
}

/**
 * "Turn on": the OS prompt while one is left, otherwise the app's page in the
 * phone's Settings. A grant lands in the store, where useNotifications picks
 * it up and registers this phone for push.
 */
export async function turnOnPush(): Promise<PushPermission> {
  const current = await readPushPermission();
  if (current === 'granted') return current;
  if (current === 'undetermined') {
    try {
      const next = toPushPermission(await Notifications.requestPermissionsAsync());
      useNotificationStore.getState().setPushPermission(next);
      return next;
    } catch {
      return current;
    }
  }
  Linking.openSettings().catch(() => {});
  return current;
}
