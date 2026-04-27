import React, { useEffect } from 'react';
import { View, Pressable, Dimensions, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SPRING = { damping: 22, stiffness: 220, mass: 0.9 } as const;

export type SheetSnap = 'peek' | 'half' | 'full';

interface ExpandableSheetProps {
  /** Fractions of the screen height for each snap point. Default: 0.18 / 0.55 / 0.92. */
  snapPoints?: { peek: number; half: number; full: number };
  initial?: SheetSnap;
  /** Optional callback whenever the user drags to a new snap. */
  onSnapChange?: (snap: SheetSnap) => void;
  /** Render the always-visible peek (e.g. ETA + key actions). Lives above the handle. */
  renderHandle?: () => React.ReactNode;
  /** Children scroll inside the sheet body. Use a ScrollView for long content. */
  children: React.ReactNode;
}

/**
 * A persistent bottom sheet with three snap points (peek / half / full).
 * Designed for screens where the user needs to alternate between viewing
 * the underlying map full-screen and reading details. Cannot be dismissed
 * (it always stays at least at `peek`), unlike `BottomSheet`.
 */
export function ExpandableSheet({
  snapPoints = { peek: 0.18, half: 0.55, full: 0.92 },
  initial = 'half',
  onSnapChange,
  renderHandle,
  children,
}: ExpandableSheetProps) {
  const peekY = SCREEN_HEIGHT * (1 - snapPoints.peek);
  const halfY = SCREEN_HEIGHT * (1 - snapPoints.half);
  const fullY = SCREEN_HEIGHT * (1 - snapPoints.full);

  const initialY = initial === 'peek' ? peekY : initial === 'full' ? fullY : halfY;
  const translateY = useSharedValue(initialY);
  const startY = useSharedValue(0);

  // Re-snap when snap points change (e.g. orientation).
  useEffect(() => {
    translateY.value = withSpring(initialY, SPRING);
  }, [initialY, translateY]);

  const snapTo = (snap: SheetSnap) => {
    const target = snap === 'peek' ? peekY : snap === 'full' ? fullY : halfY;
    translateY.value = withSpring(target, SPRING);
    onSnapChange?.(snap);
  };

  const gesture = Gesture.Pan()
    .onStart(() => {
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      const next = startY.value + e.translationY;
      translateY.value = Math.max(fullY, Math.min(peekY, next));
    })
    .onEnd((e) => {
      const current = translateY.value;
      const velocity = e.velocityY;
      // Choose target based on position + velocity for a natural feel.
      let targetY: number;
      let snap: SheetSnap;
      if (velocity > 600) {
        // Flicked downward
        targetY = current > halfY ? peekY : halfY;
        snap = current > halfY ? 'peek' : 'half';
      } else if (velocity < -600) {
        // Flicked upward
        targetY = current < halfY ? fullY : halfY;
        snap = current < halfY ? 'full' : 'half';
      } else {
        // Snap to nearest
        const dPeek = Math.abs(current - peekY);
        const dHalf = Math.abs(current - halfY);
        const dFull = Math.abs(current - fullY);
        const min = Math.min(dPeek, dHalf, dFull);
        targetY = min === dPeek ? peekY : min === dFull ? fullY : halfY;
        snap = min === dPeek ? 'peek' : min === dFull ? 'full' : 'half';
      }
      translateY.value = withSpring(targetY, SPRING);
      if (onSnapChange) runOnJS(onSnapChange)(snap);
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Subtle backdrop dim only when fully expanded.
  const backdropStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateY.value,
      [halfY, fullY],
      [0, 0.35],
      Extrapolation.CLAMP,
    );
    return { opacity };
  });

  return (
    <>
      {/* Backdrop appears only when sheet is near full so the map stays visible. */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, backdropStyle]}
      />
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: SCREEN_HEIGHT,
            backgroundColor: '#FFFFFF',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -4 },
            shadowOpacity: 0.12,
            shadowRadius: 12,
            elevation: 12,
          },
          sheetStyle,
        ]}
      >
        {/* Drag handle area — only this area receives the pan gesture so
            inner ScrollViews continue to scroll normally. */}
        <GestureDetector gesture={gesture}>
          <Pressable
            onPress={() => {
              // Quick tap on the handle cycles peek → half → full → half.
              const cur = translateY.value;
              if (Math.abs(cur - peekY) < 4) snapTo('half');
              else if (Math.abs(cur - halfY) < 4) snapTo('full');
              else snapTo('half');
            }}
          >
            <View style={styles.handleWrap}>
              <View style={styles.handleBar} />
              {renderHandle ? <View style={{ marginTop: 4 }}>{renderHandle()}</View> : null}
            </View>
          </Pressable>
        </GestureDetector>
        <View style={{ flex: 1 }}>{children}</View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  handleWrap: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  handleBar: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#CBD5E1',
  },
});
