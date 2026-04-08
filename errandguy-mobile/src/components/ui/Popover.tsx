import React from 'react';
import { View, Pressable, type ViewStyle } from 'react-native';

interface PopoverProps {
  isVisible: boolean;
  onClose: () => void;
  anchor?: ViewStyle;
  children: React.ReactNode;
}

export function Popover({
  isVisible,
  onClose,
  anchor,
  children,
}: PopoverProps) {
  if (!isVisible) return null;

  return (
    <Pressable
      className="absolute z-50"
      style={anchor}
      onPress={(e) => e.stopPropagation()}
    >
      <View className="bg-surface border border-divider rounded-xl p-3 shadow-sm">
        {children}
      </View>
    </Pressable>
  );
}
