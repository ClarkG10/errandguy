import React, { useEffect } from 'react';
import { View, Pressable, Dimensions, StyleSheet, ScrollView } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
// Smooth, non-bouncy slide-up. Critically damped so the sheet glides
// into place without any overshoot/oscillation.
const TIMING_IN = { duration: 260, easing: Easing.out(Easing.cubic) } as const;
// Closing — quick & deterministic, no overshoot.
const TIMING_OUT = { duration: 220, easing: Easing.in(Easing.cubic) } as const;

interface BottomSheetProps {
  isVisible: boolean;
  onClose: () => void;
  snapPoints?: number[];
  children: React.ReactNode;
  scrollable?: boolean;
}

export function BottomSheet({
  isVisible,
  onClose,
  snapPoints = [0.5],
  children,
  scrollable = true,
}: BottomSheetProps) {
  const translateY = useSharedValue(SCREEN_HEIGHT);
  const context = useSharedValue(0);

  const maxSnap = Math.max(...snapPoints) * SCREEN_HEIGHT;

  useEffect(() => {
    if (isVisible) {
      translateY.value = withTiming(SCREEN_HEIGHT - maxSnap, TIMING_IN);
    } else {
      translateY.value = withTiming(SCREEN_HEIGHT, TIMING_OUT);
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
        translateY.value = withTiming(SCREEN_HEIGHT, TIMING_OUT);
        runOnJS(onClose)();
      } else {
        translateY.value = withTiming(SCREEN_HEIGHT - maxSnap, TIMING_IN);
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
          className="absolute left-0 right-0 bg-surface"
          style={[
            { height: maxSnap },
            // Edge-to-edge sheet (no floating side margins) — the
            // previous mx-4 mb-6 made the sheet look like a card,
            // not a sheet. Modern apps anchor sheets to the screen
            // edges. A subtle top shadow gives depth.
            {
              shadowColor: '#0F172A',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.12,
              shadowRadius: 16,
              elevation: 12,
            },
            animatedStyle,
          ]}
        >
          <View className="items-center pt-2.5 pb-1.5">
            <View className="w-9 h-1 rounded-full bg-divider" />
          </View>
          {scrollable ? (
            <ScrollView
              className="flex-1 px-4 pb-6"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {children}
            </ScrollView>
          ) : (
            <View className="flex-1 px-4 pb-6">{children}</View>
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
