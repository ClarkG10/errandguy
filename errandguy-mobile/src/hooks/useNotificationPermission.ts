import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useNotificationStore, type PushPermission } from '../stores/notificationStore';
import { readPushPermission } from '../services/pushPermission';

/**
 * This phone's notification permission, as the store holds it ('granted',
 * 'undetermined', 'denied', or null while unknown), re-read on mount and on
 * every return to the foreground — the way to fix a "no" is often a trip to
 * the phone's Settings and back.
 *
 * Read-only: it never prompts. Turning notifications on is turnOnPush().
 */
export function useNotificationPermission(enabled = true): PushPermission {
  const permission = useNotificationStore((s) => s.pushPermission);

  useEffect(() => {
    if (!enabled) return;
    void readPushPermission();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void readPushPermission();
    });
    return () => sub.remove();
  }, [enabled]);

  return permission;
}
