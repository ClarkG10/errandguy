import { Platform } from 'react-native';

/**
 * Platform-aware stack navigation animation.
 *
 * `ios_from_right` on Android renders the iOS-style card with a
 * persistent edge shadow during transitions, which reads as a "ghost"
 * panel left behind. We use the native `slide_from_right` on Android
 * (no shadow, full GPU-accelerated translate) and keep the polished
 * iOS card animation on iOS.
 */
export const STACK_ANIMATION =
  Platform.OS === 'android' ? 'slide_from_right' : 'ios_from_right';
