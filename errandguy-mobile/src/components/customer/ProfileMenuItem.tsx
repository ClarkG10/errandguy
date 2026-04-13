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
      className="flex-row items-center py-3.5 px-1"
      onPress={onPress}
    >
      <View
        className="w-9 h-9 rounded-xl items-center justify-center mr-3"
        style={{ backgroundColor: danger ? '#FEF2F2' : '#EFF6FF' }}
      >
        <Icon size={18} color={danger ? '#EF4444' : '#2563EB'} />
      </View>
      <Text
        className={`text-sm font-montserrat flex-1 ${
          danger ? 'text-danger' : 'text-textPrimary'
        }`}
      >
        {label}
      </Text>
      {rightElement ?? <ChevronRight size={16} color="#CBD5E1" />}
    </Pressable>
  );
}
