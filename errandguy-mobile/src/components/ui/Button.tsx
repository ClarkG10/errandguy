import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  loadingTitle?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: LucideIcon;
  fullWidth?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
  testID?: string;
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

const sizePadding: Record<ButtonSize, ViewStyle> = {
  sm: { paddingVertical: 10, paddingHorizontal: 20, minHeight: 40 },
  md: { paddingVertical: 14, paddingHorizontal: 28, minHeight: 48 },
  lg: { paddingVertical: 18, paddingHorizontal: 36, minHeight: 56 },
};

const sizeTextSizes: Record<ButtonSize, number> = {
  sm: 12,
  md: 14,
  lg: 16,
};

const iconSizes: Record<ButtonSize, number> = {
  sm: 16,
  md: 20,
  lg: 24,
};

export function Button({
  title,
  loadingTitle,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  icon: Icon,
  fullWidth = false,
  onPress,
  style,
  testID,
}: ButtonProps) {
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  };

  return (
    <TouchableOpacity
      cssInterop={false}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      testID={testID}
      style={[
        bs.base,
        variantStyles[variant],
        sizePadding[size],
        fullWidth && bs.full,
        (disabled || loading) && bs.disabled,
        style,
      ]}
      disabled={disabled || loading}
      onPress={handlePress}
    >
      {Icon && !loading && (
        <Icon
          size={iconSizes[size]}
          color={variant === 'primary' || variant === 'danger' ? '#fff' : '#2563EB'}
          style={{ marginRight: 8 }}
        />
      )}
      {loading && (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' || variant === 'danger' ? '#fff' : '#2563EB'}
          style={{ marginRight: 8 }}
        />
      )}
      <Text
        cssInterop={false}
        style={[
          bs.text,
          { fontSize: sizeTextSizes[size], color: variantTextColors[variant] },
        ]}
      >
        {loading && loadingTitle ? loadingTitle : title}
      </Text>
    </TouchableOpacity>
  );
}

const bs = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
  },
  full: { width: '100%' },
  disabled: { opacity: 0.5 },
  text: { fontFamily: 'Inter_600SemiBold' },
});
