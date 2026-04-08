import React from 'react';
import { View, Text } from 'react-native';

type BadgeVariant = 'primary' | 'danger' | 'neutral';
type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  count?: number;
  label?: string;
  variant?: BadgeVariant;
  size?: BadgeSize;
}

const variantClasses: Record<BadgeVariant, { bg: string; text: string }> = {
  primary: { bg: 'bg-primary', text: 'text-white' },
  danger: { bg: 'bg-danger', text: 'text-white' },
  neutral: { bg: 'bg-divider', text: 'text-textSecondary' },
};

export function Badge({
  count,
  label,
  variant = 'primary',
  size = 'sm',
}: BadgeProps) {
  const { bg, text } = variantClasses[variant];
  const displayText = label || (count !== undefined ? String(count) : '');
  const isSmall = size === 'sm';

  if (count !== undefined && count === 0) return null;

  return (
    <View
      className={`${bg} rounded-full items-center justify-center ${
        isSmall ? 'min-w-[18px] h-[18px] px-1' : 'min-w-[24px] h-[24px] px-2'
      }`}
    >
      <Text
        className={`${text} font-montserrat-bold ${isSmall ? 'text-[10px]' : 'text-xs'}`}
      >
        {displayText}
      </Text>
    </View>
  );
}
