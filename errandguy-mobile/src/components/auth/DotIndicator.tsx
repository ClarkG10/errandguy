import React, { useEffect, useRef } from 'react';
import { View, Animated, AccessibilityInfo, type AccessibilityInfoStatic } from 'react-native';

interface DotIndicatorProps {
  total: number;
  active: number;
}

/**
 * Carousel pagination dots. The active dot animates into a soft pill
 * (12 → 24px width), giving the indicator a sense of "position progress"
 * rather than a binary on/off feel. Honors the OS reduce-motion setting.
 */
export function DotIndicator({ total, active }: DotIndicatorProps) {
  return (
    <View
      className="flex-row items-center justify-center gap-2"
      accessibilityRole="adjustable"
      accessibilityLabel={`Slide ${active + 1} of ${total}`}
    >
      {Array.from({ length: total }).map((_, index) => (
        <Dot key={index} isActive={index === active} />
      ))}
    </View>
  );
}

function Dot({ isActive }: { isActive: boolean }) {
  const width = useRef(new Animated.Value(isActive ? 24 : 8)).current;
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    (AccessibilityInfo as AccessibilityInfoStatic)
      .isReduceMotionEnabled?.()
      .then((enabled) => {
        if (mounted) reduceMotionRef.current = enabled;
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    Animated.timing(width, {
      toValue: isActive ? 24 : 8,
      duration: reduceMotionRef.current ? 0 : 220,
      useNativeDriver: false,
    }).start();
  }, [isActive, width]);

  return (
    <Animated.View
      style={{
        height: 8,
        width,
        borderRadius: 9999,
        backgroundColor: isActive ? '#2563EB' : '#DBEAFE',
      }}
    />
  );
}
