import React, { useRef } from 'react';
import {
  Pressable,
  Text,
  Animated,
  StyleSheet,
  Platform,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useResponsive } from '../../constants/responsive';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';

/**
 * Modern blue-first CTA button.
 *
 * Redesign goals (July 2026 — "clean & airy"):
 *  - Primary CTA carries the brand colour directly (#2563EB); it is
 *    the single strong accent on an otherwise neutral canvas.
 *  - CTAs are generous again — sm/md/lg ≈ 38/48/54. A taller primary
 *    button with soft corners (r16) reads confident and easy to hit;
 *    the airy canvas around it keeps the page from feeling heavy.
 *  - Optional `gradient` variant applies the brand gradient for hero
 *    moments only (welcome / book-now). Off by default — flat blue is
 *    the production default.
 *  - Elevation is a soft diffuse blue tint (low opacity, large radius)
 *    rather than a punchy drop shadow.
 *  - Trailing chevron remains opt-in for multi-step flows.
 */

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Contextual label shown *in place of* `title` while `loading` (e.g.
   *  "Logging in…", "Creating booking…"). There is no spinner — the words
   *  carry the state. Falls back to the normal `title` when omitted. */
  loadingTitle?: string;
  /** Leading icon. */
  icon?: LucideIcon;
  /** Trailing icon. Opt-in only — pass an icon (e.g. ArrowRight) when
   *  the action is part of a multi-step flow. Auth & save buttons
   *  read cleaner without one. */
  trailingIcon?: LucideIcon | null;
  fullWidth?: boolean;
  disabled?: boolean;
  /** Render the primary variant with a brand gradient. Hero use only
   *  (welcome / book-now) — flat blue is the default. */
  gradient?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
  testID?: string;
  accessibilityHint?: string;
}

const PRIMARY_BG = LightColors.primary;       // #2563EB
const PRIMARY_PRESSED = LightColors.primary700; // #1D4ED8
const DANGER_BG = LightColors.danger;
const SECONDARY_BG = LightColors.primary50;   // soft blue tint

const variantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: PRIMARY_BG },
  secondary: { backgroundColor: SECONDARY_BG },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.25,
    borderColor: PRIMARY_BG,
  },
  danger: { backgroundColor: DANGER_BG },
  ghost: { backgroundColor: 'transparent' },
};

const variantTextColors: Record<ButtonVariant, string> = {
  primary: LightColors.textInverse,
  secondary: PRIMARY_PRESSED,
  outline: PRIMARY_BG,
  danger: LightColors.textInverse,
  ghost: PRIMARY_BG,
};

// Android used to render Quicksand visibly larger/heavier than iOS's SF Pro.
// That is now solved at the root: applySystemFont() remaps both platforms to
// the system typeface (Roboto / SF Pro), which share near-identical metrics —
// so no per-platform size fudge is needed and buttons match 1:1.
const ANDROID_TEXT_SCALE = 0;
const ANDROID_PAD_SCALE = 0;

// "Compact" ladder — 30/40/44 (trimmed again from 34/44/48). lg (the
// primary CTA) now sits exactly at Apple's 44pt touch minimum — the floor
// for a main action, so it shouldn't go lower. md (40) / sm (30) dip below
// for dense or secondary/inline use and are paired with hitSlop at their
// call sites to keep the effective tap target comfortable. The tighter base
// also narrows the Android gap (width-driven mScale scales up from less).
const BASE_SIZES: Record<ButtonSize, { padV: number; padH: number; minH: number; text: number; icon: number }> = {
  sm: { padV: 5,  padH: 14, minH: 30, text: 13, icon: 15 },
  md: { padV: 8,  padH: 18, minH: 40, text: 15, icon: 17 },
  lg: { padV: 10, padH: 20, minH: 44, text: 16, icon: 18 },
};

// One family on every platform — the system-font remap turns this into
// SF Pro (iOS) / Roboto (Android) at weight 600, so the CTA reads identically
// cross-platform. (On web the loaded Inter face is used directly.)
const PLATFORM_FONT = 'Inter_600SemiBold';

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingTitle,
  disabled,
  icon: Icon,
  trailingIcon,
  fullWidth = false,
  gradient = false,
  onPress,
  style,
  testID,
  accessibilityHint,
}: ButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReducedMotion();
  const { mScale } = useResponsive();

  const base = BASE_SIZES[size];
  const sizing: ViewStyle = {
    paddingVertical: mScale(base.padV) + ANDROID_PAD_SCALE,
    paddingHorizontal: mScale(base.padH),
    minHeight: mScale(base.minH) + ANDROID_PAD_SCALE,
  };
  const textSize = mScale(base.text) + ANDROID_TEXT_SCALE;
  const iconSize = mScale(base.icon);

  const isDisabled = disabled || loading;
  const useGradient = gradient && variant === 'primary' && !isDisabled;

  const handlePressIn = () => {
    if (isDisabled || reduceMotion) return;
    Animated.spring(scale, {
      toValue: 0.97,
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

  const Trailing = trailingIcon ?? null;

  const contentColor = variantTextColors[variant];

  // Brand-tinted elevation for filled CTAs only — soft and diffuse
  // (low opacity, large radius) so the button floats rather than pops.
  // Outline / ghost / secondary stay flat so the page hierarchy reads
  // from the page surface upward.
  const elevationStyle: ViewStyle | null =
    !isDisabled && (variant === 'primary' || variant === 'danger')
      ? (Platform.select({
          ios: {
            shadowColor:
              variant === 'danger' ? LightColors.danger : LightColors.primary700,
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.14,
            shadowRadius: 16,
          },
          android: { elevation: 3 },
          default: {},
        }) as ViewStyle)
      : null;

  // Inner content (icons + label) — extracted so it can be rendered
  // identically inside a flat <Pressable> or wrapped inside a
  // <LinearGradient>.
  //
  // No spinner. Per product direction (July 2026) the button never shows
  // an animated loader — the *words* carry the state. While `loading`, we
  // swap the label to the contextual `loadingTitle` (e.g. "Cancelling…")
  // when one is supplied, otherwise keep the normal title. The button is
  // still disabled + `busy` for assistive tech, so it can't be double-fired.
  const renderContent = () => (
    <>
      {!loading && Icon && (
        <Icon
          size={iconSize}
          color={contentColor}
          strokeWidth={2}
          style={{ marginRight: 8 }}
        />
      )}
      <Text
        style={[
          bs.text,
          {
            fontSize: textSize,
            color: contentColor,
            fontFamily: PLATFORM_FONT,
          },
        ]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {loading ? (loadingTitle ?? title) : title}
      </Text>
      {!loading && Trailing && (
        <Trailing
          size={iconSize}
          color={contentColor}
          strokeWidth={2.2}
          style={{ marginLeft: 'auto', paddingLeft: 8 }}
        />
      )}
    </>
  );

  // Pressable wrapping — when gradient is on, the gradient itself
  // becomes the visible background; the Pressable handles the touch
  // and is sized to fill the gradient.
  const sharedPressableProps = {
    accessibilityRole: 'button' as const,
    accessibilityLabel: title,
    accessibilityHint,
    accessibilityState: { disabled: isDisabled, busy: loading },
    testID,
    disabled: isDisabled,
    onPress: handlePress,
    onPressIn: handlePressIn,
    onPressOut: handlePressOut,
    android_ripple:
      variant === 'ghost' || variant === 'outline' || variant === 'secondary'
        ? { color: `${LightColors.primary}1A`, borderless: false }
        : { color: `${LightColors.textInverse}29`, borderless: false },
  };

  return (
    <Animated.View
      style={[
        fullWidth && bs.full,
        elevationStyle,
        { transform: [{ scale }] },
      ]}
    >
      {useGradient ? (
        <Pressable
          {...sharedPressableProps}
          style={[
            bs.base,
            sizing,
            fullWidth && bs.full,
            isDisabled && bs.disabled,
            style,
          ]}
        >
          <LinearGradient
            pointerEvents="none"
            colors={[
              LightColors.gradientStart,
              LightColors.gradientMid,
              LightColors.gradientEnd,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {renderContent()}
        </Pressable>
      ) : (
        <Pressable
          {...sharedPressableProps}
          style={[
            bs.base,
            variantStyles[variant],
            sizing,
            fullWidth && bs.full,
            isDisabled && bs.disabled,
            style,
          ]}
        >
          {renderContent()}
        </Pressable>
      )}
    </Animated.View>
  );
}

const bs = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // Subtle 14px corner ("Modern soft") — softer/cleaner than the old
    // full pill, still friendly.
    borderRadius: Radius.button,
    overflow: 'hidden',
    position: 'relative',
  },
  full: { width: '100%' },
  disabled: { opacity: 0.45 },
  text: { letterSpacing: 0.1 },
});

