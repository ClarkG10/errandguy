import { useState, useEffect, useRef, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { userService } from '../services/user.service';
import { useAuthStore } from '../stores/authStore';

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
      return null;
    }

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
    } catch {
      // Firebase not initialized in dev — push tokens only work in EAS builds
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

  // Permission prompt + token upload stay gated on `enabled` so we don't ask
  // for notification permission mid-OTP (before a contact is verified).
  useEffect(() => {
    if (!enabled) return;
    registerForPush().then((token) => {
      if (token) {
        userService.updateFCMToken(token).catch(() => {});
      }
    });
  }, [enabled, registerForPush]);

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
      router.push('/(runner)/(tabs)/home' as never);
      break;
    case 'payment':
      router.push((isRunner ? '/(runner)/(tabs)/earnings' : '/(customer)/wallet/') as never);
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
      if (data.booking_id) {
        router.push(`/(customer)/tracking/${data.booking_id}` as never);
      }
      break;
    case 'promo':
      router.push('/(customer)/(tabs)/home' as never);
      break;
  }
}
