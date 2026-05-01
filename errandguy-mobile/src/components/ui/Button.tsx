import React, { useRef } from 'react';
import {
  Pressable,
  Text,
  Animated,
  StyleSheet,
  Platform,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { ErrandLoader } from './ErrandLoader';
import { useReducedMotion } from '../../hooks/useReducedMotion';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: LucideIcon;
  fullWidth?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
  testID?: string;
  accessibilityHint?: string;
}

const variantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: '#2563EB' },
  secondary: { backgroundColor: '#DBEAFE' },
  outline: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#2563EB' },
  danger: { backgroundColor: '#EF4444' },
  ghost: { backgroundColor: 'transparent' },
};

const variantTextColors: Record<ButtonVariant, string> = {
  primary: '#FFFFFF',
  secondary: '#2563EB',
  outline: '#2563EB',
  danger: '#FFFFFF',
  ghost: '#2563EB',
};

// Soft, brand-tinted shadow on the elevated variants only — plays into
// the "premium" feel without ever reading as a drop-shadow on flat
// outline / ghost buttons.
const variantShadow: Partial<Record<ButtonVariant, ViewStyle>> = {
  primary: {
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 4,
  },
  danger: {
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 4,
  },
};

const sizePadding: Record<ButtonSize, ViewStyle> = {
  sm: { paddingVertical: 10, paddingHorizontal: 20, minHeight: 40 },
  md: { paddingVertical: 14, paddingHorizontal: 28, minHeight: 48 },
  lg: { paddingVertical: 18, paddingHorizontal: 36, minHeight: 56 },
};

// Bumped one notch for legibility / WCAG-friendly defaults. Previously
// md was 13pt which read as "secondary text" against the bold primary
// CTA shape; 15pt feels distinctly tappable without breaking layouts.
const sizeTextSizes: Record<ButtonSize, number> = {
  sm: 13,
  md: 15,
  lg: 17,
};

const iconSizes: Record<ButtonSize, number> = {
  sm: 16,
  md: 20,
  lg: 24,
};

// Platform-appropriate body font for the CTA label. iOS leans into the
// system Inter-mapped face for crispness; Android keeps Quicksand for
// brand continuity (Roboto would feel sterile next to the rounded UI).
const PLATFORM_FONT = Platform.select({
  ios: 'Inter_600SemiBold',
  android: 'Quicksand_600SemiBold',
  default: 'Quicksand_600SemiBold',
});

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  icon: Icon,
  fullWidth = false,
  onPress,
  style,
  testID,
  accessibilityHint,
}: ButtonProps) {
  // Tactile press-down scale: 1 → 0.97 in 70ms feels responsive without
  // wobble. Spring-back on release. Skipped entirely when disabled so
  // the user never gets a phantom "it pressed" visual. Also skipped when
  // the OS "Reduce Motion" setting is on — those users have explicitly
  // asked us to keep the UI still.
  const scale = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReducedMotion();

  const isDisabled = disabled || loading;

  const handlePressIn = () => {
    if (isDisabled || reduceMotion) return;
    Animated.spring(scale, {
      toValue: 0.97,
      speed: 40,
      bounciness: 0,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    if (reduceMotion) return;
    Animated.spring(scale, {
      toValue: 1,
      speed: 30,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  };

  const handlePress = () => {
    // Haptics rejects on devices without a Taptic Engine / vibrator
    // (some budget Android, the iOS simulator). Swallow — a missing
    // buzz is never a reason to break the press handler.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress?.();
  };

  return (
    <Animated.View
      style={[
        fullWidth && bs.full,
        !isDisabled && variantShadow[variant],
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
            ? { color: 'rgba(37,99,235,0.12)', borderless: false }
            : undefined
        }
      >
        {loading ? (
          <ErrandLoader
            size={size === 'sm' ? 5 : size === 'md' ? 6 : 7}
            color={variant === 'primary' || variant === 'danger' ? '#fff' : '#2563EB'}
          />
        ) : (
          <>
            {Icon && (
              <Icon
                size={iconSizes[size]}
                color={variant === 'primary' || variant === 'danger' ? '#fff' : '#2563EB'}
                style={{ marginRight: 8 }}
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
    borderRadius: 9999,
    overflow: 'hidden',
  },
  full: { width: '100%' },
  disabled: { opacity: 0.5 },
  text: { letterSpacing: 0.1 },
});
