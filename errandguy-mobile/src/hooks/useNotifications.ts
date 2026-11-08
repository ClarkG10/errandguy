import { useState, useEffect, useRef, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, AppState } from 'react-native';
import { router } from 'expo-router';
import { userService } from '../services/user.service';
import { notificationService } from '../services/notification.service';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useChatStore } from '../stores/chatStore';
import { rememberPushToken } from '../services/pushToken';
import { toPushPermission } from '../services/pushPermission';
import { foregroundPresentation } from '../utils/pushPresentation';
import { noteSosNotification } from '../services/sosActive';
import { notificationRoute } from '../utils/notificationRoute';

// Foreground presentation. Everything shows, except a chat push for the
// thread that is open on screen right now — the message is already appearing
// in front of the person, so a banner + sound on top of it is noise
// (utils/pushPresentation).
Notifications.setNotificationHandler({
  handleNotification: async (notification) =>
    foregroundPresentation(
      notification?.request?.content?.data as Record<string, unknown> | undefined,
      useChatStore.getState().openThreadId,
    ),
});

/**
 * `askOs: false` never shows the OS permission prompt: the state is recorded
 * ('undetermined' / 'denied') and the in-app NotificationPrimer asks first.
 * The prompt is a one-shot, and spending it on a cold, unexplained dialog the
 * moment Home first renders is how a customer ends up with push off for good.
 * Once permission is granted (from the primer, or Profile → Notifications),
 * this registers the phone on its own.
 *
 * `routeReady` says the app can act on a tap: auth has hydrated, someone is
 * signed in and their role's navigator is on screen. A tap that arrives before
 * that — the one that launched a killed app — is held until it is true.
 */
export function useNotifications(
  enabled = true,
  options: { askOs?: boolean; routeReady?: boolean } = {},
) {
  const askOs = options.askOs ?? true;
  const routeReady = options.routeReady ?? true;
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const notificationListener = useRef<Notifications.EventSubscription>(null);
  const responseListener = useRef<Notifications.EventSubscription>(null);

  const registerForPush = useCallback(async () => {
    if (!Device.isDevice) {
      return null;
    }

    const existing = await Notifications.getPermissionsAsync();
    const existingStatus = existing.status;
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      if (!askOs) {
        useNotificationStore.getState().setPushPermission(toPushPermission(existing));
        return null;
      }
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      // Record the denial instead of swallowing it. A push is the ONLY channel
      // that reaches a phone in a pocket, so a runner who denies this can go
      // online, be told "You're online and ready for errands", and never hear
      // about a single offer — with nothing in the app able to explain why.
      // The runner online toggle reads this and says so.
      useNotificationStore.getState().setPushPermission('denied');

      return null;
    }

    useNotificationStore.getState().setPushPermission('granted');

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'ErrandGuy',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#2563EB',
      });
    }

    try {
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: '1684a4bc-4b59-47f4-a87e-3b3262438098',
      });
      setExpoPushToken(tokenData.data);
      // Sign-out sends it as `device_token` (services/session.service).
      rememberPushToken(tokenData.data);
      return tokenData.data;
    } catch (err) {
      // Legitimately fails in dev / Expo Go (no FCM/APNs configured); in a
      // standalone/EAS build it should succeed, so surface it in dev to aid
      // diagnosis instead of swallowing silently.
      if (__DEV__) console.warn('[push] getExpoPushTokenAsync failed', err);
      return null;
    }
  }, [askOs]);

  // Tap-handling is registered UNCONDITIONALLY on mount — independent of
  // `enabled` (which only gates the permission prompt + token upload). A
  // killed-state launch tap is delivered before auth/profile hydrate, so the
  // listener must already be live AND we must read the buffered launch
  // response (the live listener never replays it). Deduped by response id so
  // the cold-start read and a possible live re-delivery don't double-route.
  const handledResponseId = useRef<string | null>(null);
  // A killed-state launch tap lands while auth is still loading: no user, no
  // role. Routed then, a runner's tap took the customer branch (role null →
  // 'customer') and was bounced out of a screen that isn't theirs — and the
  // navigator wasn't even mounted yet. So until the app is first ready, a tap
  // is HELD (the latest wins) and routed the moment it is, through a
  // biometric unlock too. After that, taps route straight away as before.
  const appReady = useRef(false);
  const heldResponse = useRef<Notifications.NotificationResponse | null>(null);
  const routeTap = useCallback((response: Notifications.NotificationResponse) => {
    const id = response?.notification?.request?.identifier ?? null;
    if (id && handledResponseId.current === id) return;
    if (!appReady.current) {
      heldResponse.current = response;
      return;
    }
    handledResponseId.current = id;
    handleNotificationTapped(response);
  }, []);

  useEffect(() => {
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        // Presentation is setNotificationHandler's job (above). The one thing
        // read here: staff closing this device's SOS, so the card says so
        // even if the realtime socket missed it.
        const data = notification?.request?.content?.data as
          | Record<string, unknown>
          | undefined;
        if (data?.type === 'sos') void noteSosNotification({ type: 'sos', data });
      });

    responseListener.current =
      Notifications.addNotificationResponseReceivedListener(routeTap);

    // Killed-state launch tap: the OS emitted the response during startup
    // before this listener existed, so read the buffered one. routeTap holds
    // it until the app is ready (below).
    try {
      const last = Notifications.getLastNotificationResponse();
      if (last) {
        routeTap(last);
        Notifications.clearLastNotificationResponse();
      }
    } catch {
      // getLastNotificationResponse is unavailable on web — safe to ignore.
    }

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [routeTap]);

  // Route a held tap once the app is first ready. Declared after the effect
  // above so a launch tap read on the same pass is already held.
  useEffect(() => {
    if (!routeReady || appReady.current) return;
    appReady.current = true;
    const held = heldResponse.current;
    heldResponse.current = null;
    if (held) routeTap(held);
  }, [routeReady, routeTap]);

  // Tracks whether this device's token reached the server this session, so an
  // AppState re-trigger doesn't re-upload once it has — but DOES keep retrying
  // until it does.
  const tokenSynced = useRef(false);
  // One sync at a time: the mount, a foreground and a fresh grant can all ask.
  const syncing = useRef(false);

  const syncPushToken = useCallback(async () => {
    if (tokenSynced.current || syncing.current) return;
    syncing.current = true;
    try {
      const token = await registerForPush();
      if (!token) return; // no permission / simulator — nothing to sync
      // PUT /user/fcm-token is a mutation, so it bypasses the GET-only api retry
      // layer. Retry with backoff: a single connectivity blip right after
      // install / OTP must not silently lose push for the whole session.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await userService.updateFCMToken(token);
          tokenSynced.current = true;
          return;
        } catch (err) {
          if (__DEV__) console.warn(`[push] token upload failed (attempt ${attempt + 1})`, err);
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 1000 * (attempt + 1));
          });
        }
      }
    } finally {
      syncing.current = false;
    }
  }, [registerForPush]);

  // Permission prompt + token upload stay gated on `enabled` so we don't ask
  // for notification permission mid-OTP (before a contact is verified). Re-run
  // when the app returns to the foreground so a failed one-shot self-heals (the
  // first attempt may have hit a gap right after install); no-op once synced.
  useEffect(() => {
    if (!enabled) {
      // Signed out (or back in the auth flow): sign-out unregistered this
      // phone, so whoever signs in next must upload a fresh token for THEIR
      // account. Without this reset the one-per-session guard above held, and
      // a second account on the same phone never got a push at all.
      tokenSynced.current = false;
      return;
    }
    void syncPushToken();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncPushToken();
    });
    return () => sub.remove();
  }, [enabled, syncPushToken]);

  // A grant from outside this hook (the in-app primer, Profile → Notifications)
  // registers the phone straight away instead of waiting for a foreground.
  const pushGranted = useNotificationStore((s) => s.pushPermission === 'granted');
  useEffect(() => {
    if (enabled && pushGranted) void syncPushToken();
  }, [enabled, pushGranted, syncPushToken]);

  return {
    expoPushToken,
    registerForPush,
  };
}

function handleNotificationTapped(
  response: Notifications.NotificationResponse,
): void {
  const data = response.notification.request.content.data as
    | Record<string, unknown>
    | undefined;
  if (!data?.type) {
    return;
  }

  // An "SOS resolved" push can be the first this device hears of staff
  // closing the alert — note it before navigating to the errand.
  void noteSosNotification({ type: String(data.type), data });

  // The push stands for an inbox row (the server names it when one exists):
  // opening the push has read it, so the Alerts badge must drop too.
  if (typeof data.notification_id === 'string' && data.notification_id) {
    markPushRowRead(data.notification_id);
  }

  // The same notification `type` is sent to BOTH parties (e.g. booking_update
  // is a customer status ping AND the runner's job-offer / completion push),
  // so route by the recipient's role — otherwise a runner tapping a push lands
  // on a customer-only screen. The in-app inboxes route through the same map
  // (utils/notificationRoute), so a push and its inbox row always agree; a push
  // with nowhere specific to go (a staff announcement) opens the inbox rather
  // than dead-ending on whatever screen was already open.
  const role = useAuthStore.getState().role === 'runner' ? 'runner' : 'customer';
  const target = notificationRoute({ type: String(data.type), data }, role, 'push');
  if (target) router.push(target as never);
}

/**
 * Mark the inbox row behind a tapped push as read — the same two calls the
 * inbox screens make on a row tap. Best-effort: a failure leaves the row
 * unread, which the next inbox load shows honestly. The row is often not
 * loaded yet (the tap launched the app), so the local mark can't move the
 * badge; the server's own count is re-read once the write lands.
 */
function markPushRowRead(id: string): void {
  useNotificationStore.getState().markRead(id);
  notificationService
    .markAsRead(id)
    .then(() => useNotificationStore.getState().refreshUnreadCount())
    .catch(() => {});
}
