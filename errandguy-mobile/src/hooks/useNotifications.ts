import { useState, useEffect, useRef, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, AppState } from 'react-native';
import { router } from 'expo-router';
import { userService } from '../services/user.service';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function useNotifications(enabled = true) {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const notificationListener = useRef<Notifications.EventSubscription>(null);
  const responseListener = useRef<Notifications.EventSubscription>(null);

  const registerForPush = useCallback(async () => {
    if (!Device.isDevice) {
      return null;
    }

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
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
      return tokenData.data;
    } catch (err) {
      // Legitimately fails in dev / Expo Go (no FCM/APNs configured); in a
      // standalone/EAS build it should succeed, so surface it in dev to aid
      // diagnosis instead of swallowing silently.
      if (__DEV__) console.warn('[push] getExpoPushTokenAsync failed', err);
      return null;
    }
  }, []);

  // Tap-handling is registered UNCONDITIONALLY on mount — independent of
  // `enabled` (which only gates the permission prompt + token upload). A
  // killed-state launch tap is delivered before auth/profile hydrate, so the
  // listener must already be live AND we must read the buffered launch
  // response (the live listener never replays it). Deduped by response id so
  // the cold-start read and a possible live re-delivery don't double-route.
  const handledResponseId = useRef<string | null>(null);
  const routeTap = useCallback((response: Notifications.NotificationResponse) => {
    const id = response?.notification?.request?.identifier ?? null;
    if (id && handledResponseId.current === id) return;
    handledResponseId.current = id;
    handleNotificationTapped(response);
  }, []);

  useEffect(() => {
    notificationListener.current =
      Notifications.addNotificationReceivedListener(() => {
        // Foreground notification — handled by setNotificationHandler above
      });

    responseListener.current =
      Notifications.addNotificationResponseReceivedListener(routeTap);

    // Killed-state launch tap: the OS emitted the response during startup
    // before this listener existed, so read the buffered one and route it.
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

  // Tracks whether this device's token reached the server this session, so an
  // AppState re-trigger doesn't re-upload once it has — but DOES keep retrying
  // until it does.
  const tokenSynced = useRef(false);

  const syncPushToken = useCallback(async () => {
    if (tokenSynced.current) return;
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
  }, [registerForPush]);

  // Permission prompt + token upload stay gated on `enabled` so we don't ask
  // for notification permission mid-OTP (before a contact is verified). Re-run
  // when the app returns to the foreground so a failed one-shot self-heals (the
  // first attempt may have hit a gap right after install); no-op once synced.
  useEffect(() => {
    if (!enabled) return;
    void syncPushToken();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncPushToken();
    });
    return () => sub.remove();
  }, [enabled, syncPushToken]);

  return {
    expoPushToken,
    registerForPush,
  };
}

function handleNotificationTapped(
  response: Notifications.NotificationResponse,
): void {
  const data = response.notification.request.content.data as
    | Record<string, string>
    | undefined;
  if (!data?.type) {
    return;
  }

  // The same notification `type` is sent to BOTH parties (e.g. booking_update
  // is a customer status ping AND the runner's job-offer / completion push),
  // so route by the recipient's role — otherwise a runner tapping a push lands
  // on a customer-only screen (e.g. the job offer opened the customer tracking
  // screen instead of the runner errand screen). Mirrors the in-app list
  // handlers in (runner)/notifications.tsx and (customer)/notifications.tsx.
  const isRunner = useAuthStore.getState().role === 'runner';

  switch (data.type) {
    case 'booking_update':
      if (data.booking_id) {
        router.push(
          (isRunner
            ? `/(runner)/errand/${data.booking_id}`
            : `/(customer)/tracking/${data.booking_id}`) as never,
        );
      }
      break;
    case 'incoming_request':
      // Offers home = runner tab-group index; there is no /home route, so
      // '/(runner)/(tabs)/home' would land on the not-found screen. (RT-4)
      router.push('/(runner)/(tabs)' as never);
      break;
    case 'payment':
      // Land on the thing that was PAID FOR. A booking charge's push
      // ("Payment confirmed for booking EG-1234" / "Payment failed — try
      // again") carries booking_id, and the wallet shows nothing about it — the
      // customer had to back out and hunt for the errand themselves at exactly
      // the moment they were promised context. Top-ups, payouts and any push
      // without a booking keep the wallet/earnings landing.
      if (!isRunner && data.booking_id) {
        router.push(`/(customer)/tracking/${data.booking_id}` as never);
        break;
      }
      router.push((isRunner ? '/(runner)/(tabs)/earnings' : '/(customer)/wallet/') as never);
      break;
    case 'referral':
      router.push((isRunner ? '/(runner)/(tabs)/earnings' : '/(customer)/wallet/') as never);
      break;
    // Both land on the document screen: one is an admin decision on a
    // submitted document, the other is the reminder for an application left
    // unfinished (errandguy:send-onboarding-reminders). The reminder keeps its
    // own type so the server can read its own cadence history off the
    // notifications table, but the destination is the same screen.
    case 'document_update':
    case 'onboarding_reminder':
      if (isRunner) router.push('/(runner)/settings/documents' as never);
      break;
    case 'chat':
      if (data.booking_id) {
        router.push(
          (isRunner
            ? `/(runner)/chat/${data.booking_id}`
            : `/(customer)/chat/${data.booking_id}`) as never,
        );
      }
      break;
    case 'sos':
      // Role-branch like 'chat' above. An SOS alerts the OTHER participant, so
      // for a runner this notification is always about a customer's alarm —
      // and it used to push them unconditionally at the customer-only tracking
      // route, which cannot load their booking. They landed on a dead screen
      // during the one event where seconds matter.
      if (data.booking_id) {
        router.push(
          (isRunner
            ? `/(runner)/errand/${data.booking_id}`
            : `/(customer)/tracking/${data.booking_id}`) as never,
        );
      }
      break;
    case 'promo':
      // Customer home = tab-group index (no /home route). (drive-by: same
      // not-found bug as the runner offers route above.)
      router.push('/(customer)/(tabs)' as never);
      break;
  }
}
