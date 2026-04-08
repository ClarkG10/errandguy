import React, { useRef, useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { Phone } from 'lucide-react-native';

interface SOSButtonProps {
  onTrigger: () => void;
  isActive?: boolean;
}

export function SOSButton({ onTrigger, isActive = false }: SOSButtonProps) {
  const pulse = useSharedValue(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isActive) {
      pulse.value = withRepeat(withTiming(1, { duration: 1000 }), -1, true);
    } else {
      pulse.value = 0;
    }
  }, [isActive, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.2]) }],
    opacity: interpolate(pulse.value, [0, 1], [1, 0.6]),
  }));

  const handleLongPress = () => {
    onTrigger();
  };

  return (
    <Animated.View
      className="absolute bottom-24 right-4 z-40"
      style={isActive ? pulseStyle : undefined}
    >
      <Pressable
        className={`w-14 h-14 rounded-full items-center justify-center ${
          isActive ? 'bg-danger' : 'bg-danger/90'
        }`}
        onLongPress={handleLongPress}
        delayLongPress={3000}
      >
        <Phone size={24} color="#fff" />
      </Pressable>
    </Animated.View>
  );
}
