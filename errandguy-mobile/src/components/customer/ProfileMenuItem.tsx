import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

interface ProfileMenuItemProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  danger?: boolean;
  rightElement?: React.ReactNode;
}

export function ProfileMenuItem({
  icon: Icon,
  label,
  onPress,
  danger = false,
  rightElement,
}: ProfileMenuItemProps) {
  return (
    <Pressable
      className="flex-row items-center py-3.5 px-4"
      onPress={onPress}
    >
      <Icon size={20} color={danger ? '#EF4444' : '#475569'} />
      <Text
        className={`text-sm font-montserrat flex-1 ml-3 ${
          danger ? 'text-danger' : 'text-textPrimary'
        }`}
      >
        {label}
      </Text>
      {rightElement ?? <ChevronRight size={18} color="#94A3B8" />}
    </Pressable>
  );
}
