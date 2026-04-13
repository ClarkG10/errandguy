import React from 'react';
import { View, Pressable, StyleSheet, type ViewStyle } from 'react-native';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  className?: string;
}

const shadow = StyleSheet.create({
  card: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
});

export function Card({ children, style, onPress, className = '' }: CardProps) {
  const cardClass = `bg-surface rounded-2xl p-4 ${className}`;

  if (onPress) {
    return (
      <Pressable className={cardClass} style={[shadow.card, style]} onPress={onPress}>
        {children}
      </Pressable>
    );
  }

  return (
    <View className={cardClass} style={[shadow.card, style]}>
      {children}
    </View>
  );
}
