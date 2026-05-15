import React from 'react';
import { View, Text } from 'react-native';

/**
 * Compact label / count pill.
 *
 * Variants:
 *  - `primary`  — solid brand blue. Notification counts, active flags.
 *  - `soft`     — washed-blue background, blue text. Default for
 *                 non-counter labels (e.g. "NEW", "PRO", status chips).
 *  - `success`  — green for confirmed / paid / verified states.
 *  - `warning`  — amber for pending / verification needed.
 *  - `danger`   — red for unread error / cancelled.
 *  - `neutral`  — slate for inactive / informational.
 *
 * Two sizes: `sm` (default, fits in a row of text) and `md` (sits in
 * a card header).
 */
type BadgeVariant =
  | 'primary'
  | 'soft'
  | 'success'
  | 'warning'
  | 'danger'
  | 'neutral';
type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  count?: number;
  label?: string;
  variant?: BadgeVariant;
  size?: BadgeSize;
}

const variantClasses: Record<BadgeVariant, { bg: string; text: string }> = {
  primary: { bg: 'bg-primary', text: 'text-white' },
  soft: { bg: 'bg-primary50', text: 'text-primary700' },
  success: { bg: 'bg-successSoft', text: 'text-success' },
  warning: { bg: 'bg-warningSoft', text: 'text-warning' },
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
        isSmall ? 'min-w-[18px] h-[18px] px-1.5' : 'min-w-[24px] h-[24px] px-2.5'
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
