import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useEchoChannel } from './useEchoChannel';
import { useSmartPolling } from './useSmartPolling';
import { invalidateQuery } from './useQuery';
import { useNotificationStore } from '../stores/notificationStore';
import { useChatStore } from '../stores/chatStore';
import { notificationService } from '../services/notification.service';
import { chatService } from '../services/chat.service';
import { echo, retainChannel, releaseChannel } from '../services/echo';
import {
  notificationInvalidationKeys,
  type InvalidationKey,
  type NotificationSignal,
} from '../utils/notificationInvalidations';
import type { AppNotification, Conversation, Message } from '../types';

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

/**
 * ── App-wide chat watcher ────────────────────────────────────────────────
 *
 * A chat message already arrives over Reverb on `chat.{bookingId}`, but the
 * ONLY subscriber used to be the chat screen itself. So on the two screens
 * where an answer is most time-critical — the customer's tracking screen and
 * the runner's cockpit — the unread badge was driven purely by a 30s poll of
 * /chat/unread-count: both people in the app, mid-errand, and "which gate?"
 * taking up to half a minute to show up.
 *
 * This hook is already mounted app-wide for the notification stream, so it is
 * the natural place to also hold a subscription to the user's OPEN
 * conversations and count incoming messages into the same store the badges
 * read. The 30s poll stays exactly as it is — demoted to the reconcile it
 * should have been, and still the authority (it is what clears a badge read on
 * another device).
 *
 * Cheap by construction: at most MAX_WATCHED_CONVERSATIONS channels, all
 * multiplexed over the ONE websocket every other subscription already shares,
 * and ref-counted (retainChannel), so the chat screen opening the same thread
 * costs nothing extra and its own subscription survives this one going away.
 */

/** Statuses after which no message can arrive — the server's own predicate in
 *  ChatController::unreadCount / conversations. */
const CLOSED_BOOKING_STATUSES = ['completed', 'cancelled', 'no_runner'];

/** Upper bound on watched threads. A person has one live errand, occasionally
 *  two; each subscription costs a /broadcasting/auth round trip, so cap it. */
const MAX_WATCHED_CONVERSATIONS = 3;

/** Backstop cadence for re-deriving the watch set. Deliberately slow: this
 *  hook is mounted for the WHOLE session, so the interval is pure overhead for
 *  an idle user. The two event triggers below are what actually keep the set
 *  current; useSmartPolling additionally ticks on foreground and on reconnect
 *  and pauses while backgrounded/offline. */
const CHAT_WATCH_RESOLVE_MS = 300_000;

/** Floor between two event-triggered re-derivations, so a burst can only ever
 *  cost one request. */
const CHAT_WATCH_MIN_GAP_MS = 30_000;

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

  // ── Chat watch set ──────────────────────────────────────────────────────
  // The booking ids whose chat channel we hold a subscription on. Derived from
  // the conversations the user can still receive a message on.
  const [chatBookingIds, setChatBookingIds] = useState<string[]>([]);
  const watchedRef = useRef<string[]>([]);
  watchedRef.current = chatBookingIds;
  const lastNotificationResolveRef = useRef(0);

  const resolveChatWatchSet = useCallback(async () => {
    if (!userId) return;
    const response = await chatService.getConversations();
    const conversations = (response.data?.data ?? []) as Conversation[];
    const next = conversations
      // No counterparty yet ⇒ nobody can message this thread; a closed booking
      // still appears in the inbox for 14 days but can never receive one.
      .filter(
        (c) =>
          !!c?.booking_id && !!c.counterparty && !CLOSED_BOOKING_STATUSES.includes(c.status),
      )
      .slice(0, MAX_WATCHED_CONVERSATIONS)
      .map((c) => c.booking_id)
      // SORTED: the subscription effect below keys on the joined ids and only
      // cares about MEMBERSHIP. The inbox list reorders on every new message
      // (recency), so comparing in API order made "thread B got a message"
      // read as a set change — tearing down and re-authorizing every watched
      // channel, and any message landing in that gap missed the badge until
      // the next reconcile poll.
      .sort();
    // Identity-stable when nothing changed, so the subscription effect below
    // doesn't tear down and re-authorize every channel on each tick.
    setChatBookingIds((prev) =>
      prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next,
    );
  }, [userId]);

  // Re-derive on mount, on foreground, on reconnect, and every few minutes —
  // the moments at which a new conversation can have appeared. Rejections are
  // absorbed (and backed off) by useSmartPolling itself.
  useSmartPolling(resolveChatWatchSet, {
    interval: CHAT_WATCH_RESOLVE_MS,
    enabled: !!userId,
    runOnMount: true,
    pauseWhenOffline: true,
  });

  /** Something referred to a booking we're NOT watching — re-derive early
   *  instead of waiting out the backstop interval. Throttled on its own clock,
   *  so a burst costs one request rather than one each. */
  const resolveIfUnwatched = useCallback(
    (bookingId: unknown) => {
      if (typeof bookingId !== 'string' || !bookingId) return;
      if (watchedRef.current.includes(bookingId)) return;
      const now = Date.now();
      if (now - lastNotificationResolveRef.current < CHAT_WATCH_MIN_GAP_MS) return;
      lastNotificationResolveRef.current = now;
      void resolveChatWatchSet().catch(() => {});
    },
    [resolveChatWatchSet],
  );

  // Trigger 2: the reconcile poll reports unread on a thread we are NOT
  // watching. That means a conversation appeared since the set was last
  // derived and nothing announced it — most often because the RUNNER accepted
  // the errand themselves, so no notification was sent to them. Start watching
  // it now, so only that first message ever waits on the poll. Costs no extra
  // request of its own; the key is a plain string, so this re-renders only
  // when the set of unread threads actually changes.
  const unreadBookingKey = useChatStore((s) =>
    Object.keys(s.unreadByBooking).sort().join(','),
  );
  useEffect(() => {
    if (!unreadBookingKey) return;
    for (const bookingId of unreadBookingKey.split(',')) resolveIfUnwatched(bookingId);
  }, [unreadBookingKey, resolveIfUnwatched]);

  // One `.message.created` listener per watched conversation. Keyed on the
  // joined ids so the effect only re-runs when the SET actually changes.
  const watchKey = chatBookingIds.join(',');
  useEffect(() => {
    if (!userId || !watchKey) return;
    const bookingIds = watchKey.split(',');

    const subscriptions = bookingIds.map((bookingId) => {
      const channelName = `chat.${bookingId}`;
      const channel = echo.private(channelName);
      retainChannel(channelName);
      // Payload mirrors MessageResource. The store ignores our own echoed
      // message, an already-read one, and any id it has counted before, so a
      // re-delivery after a socket drop can't inflate the badge.
      const handler = (payload: Message) => {
        useChatStore.getState().noteIncomingMessage(bookingId, payload, userId);
      };
      channel.listen('.message.created', handler);
      return { channelName, channel, handler };
    });

    return () => {
      for (const sub of subscriptions) {
        // Remove only THIS listener — the chat screen may be sharing the
        // channel and must keep its own.
        sub.channel.stopListening('.message.created', sub.handler);
        releaseChannel(sub.channelName);
      }
    };
  }, [userId, watchKey]);

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
      // Trigger 1: a notification naming a booking we're not watching (the
      // runner just took the errand, so the thread only now exists). An OFFER
      // card is the one exception: it names a booking nobody has accepted, so
      // no thread can exist yet — skip the (throttled, but still pointless)
      // inbox re-derive for those.
      if (notification?.type !== 'incoming_request') {
        resolveIfUnwatched(notification?.data?.booking_id);
      }
    },
  });

  return { isConnected, fetchUnreadCount };
}
