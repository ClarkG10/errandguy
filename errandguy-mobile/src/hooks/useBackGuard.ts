import { useEffect } from 'react';
import { BackHandler, Platform, ToastAndroid, Alert } from 'react-native';

/**
 * Guards Android hardware-back / gesture-back while an in-flight task is
 * active so users don't accidentally lose their place mid-errand.
 *
 * Behaviour:
 *  - Android: intercepts hardware back. First press shows a toast hint;
 *    second press within 2s allows back to propagate (returns false).
 *  - iOS: no-op. iOS doesn't have a hardware back, and the swipe-to-go-back
 *    gesture is disabled per-screen via Stack.Screen options where needed.
 *
 * Pass `enabled=false` to disengage the guard (e.g. once the errand is
 * completed/cancelled and leaving the screen is fine).
 */
export function useBackGuard(enabled: boolean, hint = 'Errand in progress — tap back again to leave') {
  useEffect(() => {
    if (!enabled || Platform.OS !== 'android') return;

    let lastPress = 0;

    const handler = () => {
      const now = Date.now();
      if (now - lastPress < 2000) {
        // Second press inside the window — allow default back behaviour.
        return false;
      }
      lastPress = now;
      ToastAndroid.show(hint, ToastAndroid.SHORT);
      return true; // swallow this back press
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, [enabled, hint]);
}

/**
 * iOS-friendly variant that pops a confirm dialog on the provided imperative
 * trigger (e.g. when the user taps the in-app back chevron). Use this on
 * `(runner)/errand/[id].tsx` where leaving the screen mid-errand is
 * almost never intentional.
 */
export function confirmLeaveErrand(onLeave: () => void) {
  Alert.alert(
    'Leave active errand?',
    'You can come back any time, but make sure you don\'t lose track of the customer.',
    [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: onLeave },
    ],
  );
}
