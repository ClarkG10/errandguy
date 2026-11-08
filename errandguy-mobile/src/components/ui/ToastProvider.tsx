import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, AccessibilityInfo } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  X,
  CheckCircle,
  AlertCircle,
  Info,
  AlertTriangle,
} from 'lucide-react-native';
import { useToastStore, type ToastVariant } from '../../stores/toastStore';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const INVERSE = LightColors.textInverse;

// The toast is fixed-height chrome (a floating capsule, max 5 lines). At
// large accessibility text sizes an uncapped label would blow past the
// pill; cap Dynamic Type at 1.3× so it still grows for legibility while
// staying inside the capsule. Long-form/content text elsewhere is left
// to scale freely.
const CHROME_MAX_FONT_SCALE = 1.3;

const VARIANT_CONFIG: Record<
  ToastVariant,
  { bg: string; icon: typeof CheckCircle; iconColor: string; textColor: string }
> = {
  // *Dark fills, not base tones: white 13px toast text on the base
  // status colors measures 2.2–3.9:1 (worst: warning #F59E0B). The Dark
  // rungs keep the same hue language and clear 4.5:1 with white.
  success: { bg: LightColors.successDark, icon: CheckCircle, iconColor: INVERSE, textColor: INVERSE },
  error: { bg: LightColors.dangerDark, icon: AlertCircle, iconColor: INVERSE, textColor: INVERSE },
  info: { bg: LightColors.primary, icon: Info, iconColor: INVERSE, textColor: INVERSE },
  warning: { bg: LightColors.warningDark, icon: AlertTriangle, iconColor: INVERSE, textColor: INVERSE },
};

const SHOW_DURATION = 4000;
// Toasts carrying an action linger a beat longer so the user has time
// to read the label AND reach the button.
const SHOW_DURATION_ACTION = 5000;
/** Extra dwell when a screen reader is on — spoken text outlasts read text. */
const SHOW_DURATION_SR_BONUS = 3000;
// Longer messages stay up longer. Some toasts are the only receipt for money
// that just moved ("Errand cancelled. ₱480.00 was refunded to your ErrandGuy
// wallet (new balance ₱1,230.00).") and 4s wasn't enough to read one. Capped
// so a long message can't park over the screen.
const SHOW_DURATION_PER_CHAR = 50;
const SHOW_DURATION_MAX = 10_000;
/** Lines before the message truncates — enough for a full money receipt. */
export const TOAST_MAX_LINES = 5;

/** How long a toast stays up (before any screen-reader bonus). */
export function toastDuration(message: string, hasAction: boolean): number {
  const base = hasAction ? SHOW_DURATION_ACTION : SHOW_DURATION;
  return Math.min(SHOW_DURATION_MAX, base + message.length * SHOW_DURATION_PER_CHAR);
}

/**
 * The longest a toast can stay up, screen reader included. An action that
 * stays tappable this long (an Undo) must keep working for all of it.
 */
export function toastMaxDuration(message: string, hasAction: boolean): number {
  return toastDuration(message, hasAction) + SHOW_DURATION_SR_BONUS;
}

function ToastCard({
  id,
  message,
  variant,
  actionLabel,
  onAction,
}: {
  id: string;
  message: string;
  variant: ToastVariant;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { dismiss } = useToastStore();
  const reduceMotion = useReducedMotion();
  // Read inside the mount effect / callbacks without re-running them.
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const translateY = useSharedValue(-24);
  const opacity = useSharedValue(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;

  const handleDismiss = useCallback(() => dismiss(id), [dismiss, id]);

  const animateOut = useCallback(() => {
    // Rule 20: short and subtle; a plain fade under Reduce Motion.
    const duration = reduceMotionRef.current ? 120 : 200;
    if (!reduceMotionRef.current) {
      translateY.value = withTiming(-24, { duration, easing: Easing.in(Easing.cubic) });
    }
    opacity.value = withTiming(0, { duration, easing: Easing.inOut(Easing.ease) }, () => {
      runOnJS(handleDismiss)();
    });
  }, [translateY, opacity, handleDismiss]);

  useEffect(() => {
    // Settle in from just above — no slide under Reduce Motion.
    if (reduceMotionRef.current) {
      translateY.value = 0;
      opacity.value = withTiming(1, { duration: 120 });
    } else {
      translateY.value = withSpring(0, { damping: 22, stiffness: 320, mass: 0.7 });
      opacity.value = withTiming(1, { duration: 200 });
    }

    // Toast is the app's primary transient feedback and it auto-dismisses,
    // so a screen-reader user who heard nothing had no way to recover the
    // message. accessibilityLiveRegion above covers Android; iOS needs an
    // explicit announce (same pattern as OTPInput / book/confirm). Announcing
    // on iOS ONLY — doing both on Android double-speaks.
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(message);
    }

    // Auto-dismiss timer, scaled to the message length. Spoken text takes
    // longer than read text, so screen-reader users get a longer dwell still.
    const baseDuration = toastDuration(message, !!(actionLabel && onAction));
    let cancelled = false;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((enabled) => {
        if (cancelled) return;
        if (!enabled) return;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(animateOut, baseDuration + SHOW_DURATION_SR_BONUS);
      })
      .catch(() => {});

    timerRef.current = setTimeout(animateOut, baseDuration);

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleManualDismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    animateOut();
  }, [animateOut]);

  const handleAction = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    onAction?.();
    animateOut();
  }, [onAction, animateOut]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[styles.card, { backgroundColor: config.bg }, style]}
      accessibilityRole="alert"
      // Android live region. Only errors interrupt speech in progress —
      // 'polite' queues everything else behind whatever is being read.
      accessibilityLiveRegion={variant === 'error' ? 'assertive' : 'polite'}
    >
      <Icon size={20} color={config.iconColor} style={styles.icon} />
      <Text
        style={[styles.message, { color: config.textColor }]}
        numberOfLines={TOAST_MAX_LINES}
        maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
      >
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={handleAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={styles.actionBtn}
        >
          <Text
            style={[styles.actionLabel, { color: config.textColor }]}
            numberOfLines={1}
            maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
          >
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={handleManualDismiss}
        hitSlop={14}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={styles.icon}
      >
        <X size={16} color={config.iconColor} />
      </Pressable>
    </Animated.View>
  );
}

export function ToastProvider() {
  const toasts = useToastStore((s) => s.toasts);
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  return (
    <View
      style={[
        styles.container,
        { top: insets.top + (Platform.OS === 'android' ? 8 : 4) },
      ]}
      pointerEvents="box-none"
    >
      {toasts.slice(-3).map((t) => (
        <ToastCard key={t.id} {...t} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    gap: 8,
  },
  card: {
    flexDirection: 'row',
    // Top-aligned so a 3–5 line receipt keeps its icon by the first line.
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    // A rounded card, not a 999 pill: multi-line toasts (money receipts, the
    // location prompt) looked like a squashed lozenge as a capsule.
    borderRadius: Radius.card,
    gap: 10,
    // Soft diffuse lift (Elevation.md language).
    shadowColor: LightColors.textPrimary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  message: {
    flex: 1,
    fontSize: 13.5,
    fontFamily: 'Quicksand_500Medium',
    lineHeight: 19,
    fontVariant: ['tabular-nums'],
  },
  // Optically centre a 20pt glyph on the first 19pt line.
  icon: { marginTop: 0 },
  // Right-aligned inline action ("Undo", "View"). minHeight 44 with a
  // negative vertical margin keeps a full-size touch target without
  // fattening the pill visually.
  actionBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
    marginVertical: -12,
  },
  actionLabel: {
    fontSize: 13,
    fontFamily: 'Quicksand_700Bold',
    textDecorationLine: 'underline',
  },
});
