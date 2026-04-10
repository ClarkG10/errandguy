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
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: LucideIcon;
  fullWidth?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}

const variantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: '#2563EB' },
  secondary: { backgroundColor: '#DBEAFE' },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#2563EB' },
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
  sm: { paddingVertical: 8, paddingHorizontal: 16 },
  md: { paddingVertical: 12, paddingHorizontal: 24 },
  lg: { paddingVertical: 16, paddingHorizontal: 32 },
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
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  icon: Icon,
  fullWidth = false,
  onPress,
  style,
}: ButtonProps) {
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  };

  return (
    <TouchableOpacity
      cssInterop={false}
      activeOpacity={0.8}
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
      {loading ? (
        <ActivityIndicator
          size="small"
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
            cssInterop={false}
            style={[
              bs.text,
              { fontSize: sizeTextSizes[size], color: variantTextColors[variant] },
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const bs = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  full: { width: '100%' },
  disabled: { opacity: 0.5 },
  text: { fontFamily: 'Lato_700Bold' },
});
