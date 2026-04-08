import { useState, useEffect, useRef, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { userService } from '../services/user.service';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function useNotifications() {
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
        sound: 'default',
      });
    }

    const tokenData = await Notifications.getExpoPushTokenAsync();
    setExpoPushToken(tokenData.data);
    return tokenData.data;
  }, []);

  useEffect(() => {
    registerForPush().then((token) => {
      if (token) {
        userService.updateFCMToken(token).catch(() => {});
      }
    });

    notificationListener.current =
      Notifications.addNotificationReceivedListener(() => {
        // Foreground notification — handled by setNotificationHandler above
      });

    responseListener.current =
      Notifications.addNotificationResponseReceivedListener(
        handleNotificationTapped,
      );

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [registerForPush]);

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

  switch (data.type) {
    case 'booking_update':
      if (data.booking_id) {
        router.push(`/(customer)/tracking/${data.booking_id}` as never);
      }
      break;
    case 'incoming_request':
      router.push('/(runner)/(tabs)/home' as never);
      break;
    case 'payment':
      router.push('/(customer)/wallet/' as never);
      break;
    case 'chat':
      if (data.booking_id) {
        router.push(`/(customer)/chat/${data.booking_id}` as never);
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
