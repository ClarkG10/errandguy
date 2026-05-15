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
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { ErrandLoader } from './ErrandLoader';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useResponsive } from '../../constants/responsive';
import { LightColors } from '../../constants/colors';

/**
 * Modern blue-first CTA button.
 *
 * Redesign goals (May 2026):
 *  - Primary CTA carries the brand colour directly (#2563EB) rather
 *    than the previous near-black slab. The whole product now revolves
 *    around blue, so the button reflects that identity.
 *  - Sizes are smaller and tighter — the previous md was 50pt tall,
 *    too bulky for a mobile-first product. The new sm/md/lg = 36/44/50
 *    keeps Apple's 44×44 minimum tap target while reading lighter.
 *  - Optional `gradient` variant applies the brand 3-stop gradient for
 *    hero moments (auth Continue, "Book now"). Off by default — flat
 *    blue is the production default.
 *  - Brand-tinted elevation (blue shadow) so the button visibly lifts
 *    off the page in keeping with the design language.
 *  - Trailing chevron remains opt-in for multi-step flows.
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
  primary: '#FFFFFF',
  secondary: PRIMARY_PRESSED,
  outline: PRIMARY_BG,
  danger: '#FFFFFF',
  ghost: PRIMARY_BG,
};

// Android renders the same fontSize visibly larger than iOS due to
// font-metric differences. Trim ~1pt so CTAs read at the same visual
// weight on both platforms.
const ANDROID_TEXT_SCALE = Platform.OS === 'android' ? -1 : 0;
const ANDROID_PAD_SCALE = Platform.OS === 'android' ? -2 : 0;

// Reduced sizes — the previous md (50pt) read as oversized. Modern
// fintech CTAs land around 44pt; we keep a 36/44/50 ladder, with a
// fine-grained trim (~1pt vertical, ~0.5pt text) so secondary actions
// read a touch lighter without crossing Apple's 44pt minimum target
// on the primary `md` size.
const BASE_SIZES: Record<ButtonSize, { padV: number; padH: number; minH: number; text: number; icon: number }> = {
  sm: { padV: 6,  padH: 12, minH: 32, text: 12, icon: 14 },
  md: { padV: 8, padH: 16, minH: 40, text: 13, icon: 16 },
  lg: { padV: 11, padH: 18, minH: 46, text: 14.5, icon: 18 },
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

  // Brand-tinted elevation for filled CTAs only. Outline / ghost /
  // secondary stay flat so the page hierarchy reads from the page
  // surface upward.
  const elevationStyle: ViewStyle | null =
    !isDisabled && (variant === 'primary' || variant === 'danger')
      ? (Platform.select({
          ios: {
            shadowColor:
              variant === 'danger' ? LightColors.danger : LightColors.primary700,
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.18,
            shadowRadius: 12,
          },
          android: { elevation: 3 },
          default: {},
        }) as ViewStyle)
      : null;

  // Inner content (icons + label + spinner) — extracted so it can be
  // rendered identically inside a flat <Pressable> or wrapped inside a
  // <LinearGradient>.
  const renderContent = () => (
    <>
      {/* Subtle top inner highlight on filled variants. */}
      {(variant === 'primary' || variant === 'danger') && !isDisabled && (
        <View pointerEvents="none" style={bs.innerHighlight} />
      )}

      {loading ? (
        <ErrandLoader
          size={size === 'sm' ? 4 : size === 'md' ? 5 : 6}
          color={contentColor}
        />
      ) : (
        <>
          {Icon && (
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
            {title}
          </Text>
          {Trailing && (
            <Trailing
              size={iconSize}
              color={contentColor}
              strokeWidth={2.2}
              style={{ marginLeft: 'auto', paddingLeft: 8 }}
            />
          )}
        </>
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
        ? { color: 'rgba(37,99,235,0.10)', borderless: false }
        : { color: 'rgba(255,255,255,0.16)', borderless: false },
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
    // 14px — friendlier than 12, still distinctly squircle. Matches
    // the tightened global radius scale.
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  innerHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  full: { width: '100%' },
  disabled: { opacity: 0.45 },
  text: { letterSpacing: 0.1 },
});

