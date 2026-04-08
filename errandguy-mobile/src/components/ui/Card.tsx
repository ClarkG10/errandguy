import React from 'react';
import { View, Pressable, type ViewStyle } from 'react-native';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  className?: string;
}

export function Card({ children, style, onPress, className = '' }: CardProps) {
  const cardClass = `bg-surface border border-divider rounded-[14px] p-4 ${className}`;

  if (onPress) {
    return (
      <Pressable className={cardClass} style={style} onPress={onPress}>
        {children}
      </Pressable>
    );
  }

  return (
    <View className={cardClass} style={style}>
      {children}
    </View>
  );
}
