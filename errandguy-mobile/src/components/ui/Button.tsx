import React, { useRef } from 'react';
import {
  Pressable,
  Text,
  Animated,
  StyleSheet,
  Platform,
  View,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { ErrandLoader } from './ErrandLoader';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/**
 * Modern CTA button — signature look.
 *
 * Design intent — the previous button read as a generic flat slab.
 * This iteration gives the primary CTA a recognisable, premium
 * silhouette without screaming for attention:
 *
 *  - Soft 14px radius. Distinctly squircle, never a pill.
 *  - Solid ink-dark primary by default with a real elevation shadow
 *    (not just an inner highlight) so the button visibly sits above
 *    the page — the way Linear, Revolut and Bolt CTAs do.
 *  - SIGNATURE TRAILING CHEVRON BUBBLE — on primary fullWidth CTAs the
 *    auto ArrowRight is rendered inside a small contrasting circle on
 *    the right edge. This is the recognisable "forward" gesture in
 *    modern fintech (Wise, Cash App, Monzo "continue" button).
 *  - Inner top highlight on filled variants for tactility.
 *  - Tighter press scale (0.98) — the previous 0.97 felt cheap.
 */

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Leading icon. */
  icon?: LucideIcon;
  /** Trailing icon. Opt-in only — pass an icon (e.g. ArrowRight) when
   *  the action is part of a multi-step flow. Auth & save buttons
   *  read cleaner without one. */
  trailingIcon?: LucideIcon | null;
  fullWidth?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
  testID?: string;
  accessibilityHint?: string;
}

const variantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: '#0F172A' },
  secondary: { backgroundColor: '#F1F5F9' },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#0F172A',
  },
  danger: { backgroundColor: '#EF4444' },
  ghost: { backgroundColor: 'transparent' },
};

const variantTextColors: Record<ButtonVariant, string> = {
  primary: '#FFFFFF',
  secondary: '#0F172A',
  outline: '#0F172A',
  danger: '#FFFFFF',
  ghost: '#0F172A',
};

// Android renders the same fontSize visibly larger than iOS due to
// font-metric differences. Trim ~1pt across the board on Android so
// CTAs read at the same visual weight on both platforms.
const ANDROID_TEXT_SCALE = Platform.OS === 'android' ? -1 : 0;
const ANDROID_PAD_SCALE = Platform.OS === 'android' ? -2 : 0;

const sizePadding: Record<ButtonSize, ViewStyle> = {
  sm: { paddingVertical: 9 + ANDROID_PAD_SCALE, paddingHorizontal: 16, minHeight: 38 + ANDROID_PAD_SCALE },
  md: { paddingVertical: 14 + ANDROID_PAD_SCALE, paddingHorizontal: 20, minHeight: 50 + ANDROID_PAD_SCALE },
  lg: { paddingVertical: 16 + ANDROID_PAD_SCALE, paddingHorizontal: 22, minHeight: 54 + ANDROID_PAD_SCALE },
};

const sizeTextSizes: Record<ButtonSize, number> = {
  sm: 13 + ANDROID_TEXT_SCALE,
  md: 14.5 + ANDROID_TEXT_SCALE,
  lg: 15.5 + ANDROID_TEXT_SCALE,
};

const iconSizes: Record<ButtonSize, number> = {
  sm: 14,
  md: 17,
  lg: 19,
};

const PLATFORM_FONT = Platform.select({
  ios: 'Inter_600SemiBold',
  android: 'Quicksand_700Bold',
  default: 'Quicksand_700Bold',
});

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  icon: Icon,
  trailingIcon,
  fullWidth = false,
  onPress,
  style,
  testID,
  accessibilityHint,
}: ButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReducedMotion();

  const isDisabled = disabled || loading;

  const handlePressIn = () => {
    if (isDisabled || reduceMotion) return;
    Animated.spring(scale, {
      toValue: 0.98,
      speed: 50,
      bounciness: 0,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    if (reduceMotion) return;
    Animated.spring(scale, {
      toValue: 1,
      speed: 40,
      bounciness: 4,
      useNativeDriver: true,
    }).start();
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress?.();
  };

  // Trailing icon is opt-in only — pass `trailingIcon={ArrowRight}`
  // when it adds meaning (e.g. "Continue" steps in a flow). Auth and
  // single-action CTAs (Login, Save, Get started) read cleaner without
  // a decorative arrow.
  const Trailing = trailingIcon ?? null;

  const contentColor =
    variant === 'primary' || variant === 'danger' ? '#FFFFFF' : '#0F172A';

  // Lighter, modern elevation — the previous one read as 2014-era
  // chunky-shadow. Stripe/Linear keep CTAs almost flat with a tiny
  // colour-tinted shadow so the page feels calm.
  const elevationStyle: ViewStyle | null =
    !isDisabled && (variant === 'primary' || variant === 'danger')
      ? (Platform.select({
          ios: {
            shadowColor: variant === 'danger' ? '#EF4444' : '#0F172A',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.10,
            shadowRadius: 10,
          },
          android: { elevation: 2 },
          default: {},
        }) as ViewStyle)
      : null;

  return (
    <Animated.View
      style={[
        fullWidth && bs.full,
        elevationStyle,
        { transform: [{ scale }] },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        testID={testID}
        style={[
          bs.base,
          variantStyles[variant],
          sizePadding[size],
          fullWidth && bs.full,
          isDisabled && bs.disabled,
          style,
        ]}
        disabled={isDisabled}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        android_ripple={
          variant === 'ghost' || variant === 'outline'
            ? { color: 'rgba(15,23,42,0.08)', borderless: false }
            : { color: 'rgba(255,255,255,0.12)', borderless: false }
        }
      >
        {/* Subtle top inner highlight on filled variants. */}
        {(variant === 'primary' || variant === 'danger') && !isDisabled && (
          <View pointerEvents="none" style={bs.innerHighlight} />
        )}

        {loading ? (
          <ErrandLoader
            size={size === 'sm' ? 5 : size === 'md' ? 6 : 7}
            color={contentColor}
          />
        ) : (
          <>
            {Icon && (
              <Icon
                size={iconSizes[size]}
                color={contentColor}
                strokeWidth={2}
                style={{ marginRight: 10 }}
              />
            )}
            <Text
              style={[
                bs.text,
                {
                  fontSize: sizeTextSizes[size],
                  color: variantTextColors[variant],
                  fontFamily: PLATFORM_FONT,
                },
              ]}
            >
              {title}
            </Text>
            {Trailing && (
              <Trailing
                size={iconSizes[size]}
                color={contentColor}
                strokeWidth={2.2}
                style={{ marginLeft: 'auto', paddingLeft: 10 }}
              />
            )}
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const bs = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // 12px — modern fintech radius. Distinctly squared off compared
    // to the previous 14px squircle; reads as deliberate, not generic.
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  innerHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  full: { width: '100%' },
  disabled: { opacity: 0.4 },
  text: { letterSpacing: 0.1 },
});
