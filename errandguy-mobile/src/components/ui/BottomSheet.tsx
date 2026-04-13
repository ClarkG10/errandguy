import React, { useCallback, useEffect } from 'react';
import { View, Pressable, Dimensions, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const TIMING_CONFIG = { duration: 300, easing: Easing.out(Easing.cubic) };

interface BottomSheetProps {
  isVisible: boolean;
  onClose: () => void;
  snapPoints?: number[];
  children: React.ReactNode;
}

export function BottomSheet({
  isVisible,
  onClose,
  snapPoints = [0.5],
  children,
}: BottomSheetProps) {
  const translateY = useSharedValue(SCREEN_HEIGHT);
  const context = useSharedValue(0);

  const maxSnap = Math.max(...snapPoints) * SCREEN_HEIGHT;

  useEffect(() => {
    if (isVisible) {
      translateY.value = withTiming(SCREEN_HEIGHT - maxSnap, TIMING_CONFIG);
    } else {
      translateY.value = withTiming(SCREEN_HEIGHT, TIMING_CONFIG);
    }
  }, [isVisible, maxSnap, translateY]);

  const gesture = Gesture.Pan()
    .onStart(() => {
      context.value = translateY.value;
    })
    .onUpdate((event) => {
      translateY.value = Math.max(
        event.translationY + context.value,
        SCREEN_HEIGHT - maxSnap,
      );
    })
    .onEnd((event) => {
      if (event.translationY > 100) {
        translateY.value = withTiming(SCREEN_HEIGHT, TIMING_CONFIG);
        runOnJS(onClose)();
      } else {
        translateY.value = withTiming(SCREEN_HEIGHT - maxSnap, TIMING_CONFIG);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!isVisible) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        className="flex-1 bg-black/40"
        onPress={onClose}
      />
      <GestureDetector gesture={gesture}>
        <Animated.View
          className="absolute left-0 right-0 bg-surface rounded-t-[24px] mx-4 mb-6"
          style={[{ height: maxSnap }, animatedStyle]}
        >
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 rounded-full bg-divider" />
          </View>
          <View className="flex-1 px-4 pb-6">{children}</View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
