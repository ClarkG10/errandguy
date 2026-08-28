import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useEchoChannel } from './useEchoChannel';
import { invalidateQuery } from './useQuery';
import { useNotificationStore } from '../stores/notificationStore';
import { notificationService } from '../services/notification.service';
import {
  notificationInvalidationKeys,
  type InvalidationKey,
  type NotificationSignal,
} from '../utils/notificationInvalidations';
import type { AppNotification } from '../types';

/**
 * Minimum gap between two invalidations of the SAME key prefix. A burst of
 * notifications (a runner racing through four status steps, an admin bulk
 * action) would otherwise fire one refetch per row; the mapped keys are
 * shared, so repeats inside the window collapse into a single trailing
 * revalidation instead.
 */
const INVALIDATION_MIN_GAP_MS = 1_000;

/** prefix → timestamp of its last invalidation. Bounded by the key map. */
const lastInvalidatedAt = new Map<string, number>();
/** prefix → pending trailing invalidation, so a burst refetches exactly once. */
const trailingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function fireInvalidation(id: string, key: InvalidationKey): void {
  lastInvalidatedAt.set(id, Date.now());
  // Fire-and-forget: a cache-eviction failure must never break the inbox.
  void invalidateQuery(key).catch(() => {});
}

/**
 * Turn a delivered notification into cache invalidations so the screen it
 * describes heals immediately instead of waiting out its staleTime. Unknown
 * types map to no keys and behave exactly as before.
 */
function applyNotificationInvalidations(signal: NotificationSignal): void {
  const keys = notificationInvalidationKeys(signal);
  if (keys.length === 0) return;
  const now = Date.now();
  for (const key of keys) {
    const id = key.join(':');
    const elapsed = now - (lastInvalidatedAt.get(id) ?? 0);
    if (elapsed >= INVALIDATION_MIN_GAP_MS) {
      fireInvalidation(id, key);
      continue;
    }
    // Inside the window the event is NOT dropped — a real pair lands this
    // close together (delivered → completed) and the in-flight refetch the
    // first one started can easily answer with the pre-change row. Collapse
    // every repeat into ONE trailing invalidation at the end of the window so
    // the last event still wins, at one extra request per burst.
    if (trailingTimers.has(id)) continue;
    trailingTimers.set(
      id,
      setTimeout(() => {
        trailingTimers.delete(id);
        fireInvalidation(id, key);
      }, INVALIDATION_MIN_GAP_MS - elapsed),
    );
  }
}

export function useRealtimeNotifications(userId: string | null) {
  // Per-field selectors — this hook is mounted app-wide; a whole-store
  // useNotificationStore() would re-run it on every notification add/read.
  const addNotification = useNotificationStore((s) => s.addNotification);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await notificationService.getUnreadCount();
      setUnreadCount(response.data.data.unread_count);
    } catch {
      // silently fail
    }
  }, [setUnreadCount]);

  // Seed + keep the tab badge authoritative from /notifications/unread-count.
  // Without this the badge started at 0 and only reflected realtime increments
  // (and whatever the Alerts list had loaded), so a cold start with N unread
  // showed nothing — or an early push showed "1" instead of "N+1" — until the
  // user opened the list. Re-sync on foreground since a notification may have
  // been read/added on another device (or via a tapped push) while backgrounded.
  useEffect(() => {
    if (!userId) return;
    void fetchUnreadCount();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void fetchUnreadCount();
    });
    return () => sub.remove();
  }, [userId, fetchUnreadCount]);

  const { isConnected } = useEchoChannel({
    channel: `notifications.${userId}`,
    event: 'notification.created',
    enabled: !!userId,
    // Payload mirrors NotificationResource exactly (delivered directly, not in
    // any `{ new }` change envelope), so it drops straight into the store.
    onEvent: (payload) => {
      const notification = payload as AppNotification;
      addNotification(notification);
      // The notification names the entity that changed — refresh it now rather
      // than leaving the user on a stale screen until its next poll.
      applyNotificationInvalidations({
        type: notification?.type,
        data: notification?.data ?? null,
      });
    },
  });

  return { isConnected, fetchUnreadCount };
}
