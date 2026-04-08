import React from 'react';
import {
  Pressable,
  Text,
  ActivityIndicator,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<PressableProps, 'children'> {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: LucideIcon;
  fullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary',
  secondary: 'bg-primaryLight',
  outline: 'bg-transparent border border-primary',
  danger: 'bg-danger',
  ghost: 'bg-transparent',
};

const variantTextClasses: Record<ButtonVariant, string> = {
  primary: 'text-white',
  secondary: 'text-primary',
  outline: 'text-primary',
  danger: 'text-white',
  ghost: 'text-primary',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'py-2 px-4',
  md: 'py-3 px-6',
  lg: 'py-4 px-8',
};

const sizeTextClasses: Record<ButtonSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
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
  ...rest
}: ButtonProps) {
  const handlePress = (e: any) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.(e);
  };

  return (
    <Pressable
      className={`flex-row items-center justify-center rounded-lg ${variantClasses[variant]} ${sizeClasses[size]} ${fullWidth ? 'w-full' : ''} ${disabled || loading ? 'opacity-50' : ''}`}
      disabled={disabled || loading}
      onPress={handlePress}
      {...rest}
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
            className={`font-montserrat-bold ${variantTextClasses[variant]} ${sizeTextClasses[size]}`}
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}
