import React from 'react';
import { Pressable, Text } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

interface ProfileMenuItemProps {
  /**
   * Kept in the prop signature for backwards compatibility with callers
   * that still pass an icon. The icon is intentionally NOT rendered —
   * the design is text-first to match native settings patterns.
   */
  icon?: LucideIcon;
  label: string;
  onPress: () => void;
  danger?: boolean;
  rightElement?: React.ReactNode;
}

export function ProfileMenuItem({
  label,
  onPress,
  danger = false,
  rightElement,
}: ProfileMenuItemProps) {
  return (
    <Pressable
      className="flex-row items-center justify-between py-4 px-1"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text
        className={`text-[15px] font-montserrat flex-1 ${
          danger ? 'text-danger' : 'text-textPrimary'
        }`}
      >
        {label}
      </Text>
      {rightElement ?? <ChevronRight size={16} color="#CBD5E1" />}
    </Pressable>
  );
}
