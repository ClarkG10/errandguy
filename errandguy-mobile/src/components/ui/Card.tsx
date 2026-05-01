import React from 'react';
import { View, Pressable, StyleSheet, type ViewStyle } from 'react-native';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  className?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
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

export function Card({
  children,
  style,
  onPress,
  className = '',
  accessibilityLabel,
  accessibilityHint,
  testID,
}: CardProps) {
  const cardClass = `bg-surface rounded-2xl p-4 ${className}`;

  if (onPress) {
    return (
      <Pressable
        className={cardClass}
        style={({ pressed }) => [
          shadow.card,
          // Subtle press feedback for tappable cards: slight inset feel
          // via opacity + tiny scale. Native ripple on Android.
          pressed && { opacity: 0.92, transform: [{ scale: 0.995 }] },
          style,
        ]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        testID={testID}
        android_ripple={{ color: 'rgba(37,99,235,0.08)' }}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View className={cardClass} style={[shadow.card, style]} testID={testID}>
      {children}
    </View>
  );
}
