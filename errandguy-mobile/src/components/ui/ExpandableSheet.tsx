import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';

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
  /**
   * Sticky footer rendered ABOVE the sheet at the bottom of the screen. Always
   * visible regardless of snap position, so primary CTAs (Continue, Cancel,
   * SOS) never get clipped when the user collapses the sheet to peek.
   */
  footer?: React.ReactNode;
  /**
   * When the OS "Reduce Motion" setting is on, programmatic snaps (initial
   * position, tap-cycle, screen-reader increment/decrement) use a short
   * timing curve instead of the spring. The pan gesture keeps the spring —
   * gesture-tracked motion is exempt per the HIG.
   */
  reduceMotion?: boolean;
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
  footer,
  reduceMotion = false,
}: ExpandableSheetProps) {
  const insets = useSafeAreaInsets();
  // Measured footer height. The old fixed `88 + insets.bottom` reserve was
  // tuned for a single-button footer — stacked footers (SOS + banner +
  // Cancel on tracking) run past 150pt and clipped the last content rows.
  // Until the first onLayout lands we fall back to the old constant so
  // existing single-button consumers render identically on frame one.
  const [footerH, setFooterH] = useState<number | null>(null);
  // Measured handle height, so the tap-target slop below grows the target to
  // the 44pt floor and no further — a fixed down-slop would swallow taps on
  // the body under tall renderHandle content. Pre-layout default = the bare
  // 16pt strip (handleWrap padding 8+4 around the 4pt bar).
  const [handleH, setHandleH] = useState(16);
  // Hook, not module-scope Dimensions.get: snap points must track
  // rotation and iPad split-view resizes, which re-fire the initialY
  // re-snap effect below.
  const { height: SCREEN_HEIGHT } = useWindowDimensions();
  const peekY = SCREEN_HEIGHT * (1 - snapPoints.peek);
  const halfY = SCREEN_HEIGHT * (1 - snapPoints.half);
  const fullY = SCREEN_HEIGHT * (1 - snapPoints.full);

  const initialY = initial === 'peek' ? peekY : initial === 'full' ? fullY : halfY;
  const translateY = useSharedValue(initialY);
  const startY = useSharedValue(0);

  // Ref, not a dep: toggling Reduce Motion mid-session must not re-fire the
  // initial-position effect (that would stomp the user's chosen snap).
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  // Re-snap when snap points change (e.g. orientation).
  useEffect(() => {
    translateY.value = reduceMotionRef.current
      ? withTiming(initialY, { duration: 200 })
      : withSpring(initialY, SPRING);
  }, [initialY, translateY]);

  const snapTo = (snap: SheetSnap) => {
    const target = snap === 'peek' ? peekY : snap === 'full' ? fullY : halfY;
    translateY.value = reduceMotion
      ? withTiming(target, { duration: 200 })
      : withSpring(target, SPRING);
    onSnapChange?.(snap);
  };

  // Where the sheet currently sits, by nearest snap point — mirrors the
  // no-velocity branch of the pan gesture below.
  const nearestSnap = (): SheetSnap => {
    const current = translateY.value;
    const dPeek = Math.abs(current - peekY);
    const dHalf = Math.abs(current - halfY);
    const dFull = Math.abs(current - fullY);
    const min = Math.min(dPeek, dHalf, dFull);
    return min === dPeek ? 'peek' : min === dFull ? 'full' : 'half';
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
        style={[StyleSheet.absoluteFill, { backgroundColor: LightColors.ink }, backdropStyle]}
      />
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: SCREEN_HEIGHT,
            backgroundColor: LightColors.surface,
            borderTopLeftRadius: Radius.sheet,
            borderTopRightRadius: Radius.sheet,
            shadowColor: LightColors.textPrimary,
            shadowOffset: { width: 0, height: -10 },
            shadowOpacity: 0.08,
            shadowRadius: 24,
            elevation: 24,
            zIndex: 999,
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
            // The bare handle strip is only ~16pt tall — grow the tap
            // target to the 44pt floor, but no further: excess down-slop
            // steals taps from non-touchable body content. Slop must extend
            // DOWN (into the sheet body, where later-mounted touchables
            // still win the hit test); slop above the sheet edge is outside
            // the parent and never receives touches.
            onLayout={(e) => setHandleH(e.nativeEvent.layout.height)}
            hitSlop={{ top: 8, bottom: Math.max(0, 44 - handleH - 8) }}
            // The pan gesture is invisible to screen readers — this button
            // plus increment/decrement is the only SR-operable resize path.
            accessibilityRole="button"
            accessibilityLabel="Resize panel"
            accessibilityHint="Cycles between collapsed, half, and full height"
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) => {
              const order: SheetSnap[] = ['peek', 'half', 'full'];
              const idx = order.indexOf(nearestSnap());
              if (e.nativeEvent.actionName === 'increment' && idx < order.length - 1) {
                snapTo(order[idx + 1]);
              } else if (e.nativeEvent.actionName === 'decrement' && idx > 0) {
                snapTo(order[idx - 1]);
              }
            }}
          >
            <View style={styles.handleWrap}>
              <View style={styles.handleBar} />
              {renderHandle ? <View style={{ marginTop: 4 }}>{renderHandle()}</View> : null}
            </View>
          </Pressable>
        </GestureDetector>
        <View style={{ flex: 1, paddingBottom: footer ? (footerH ?? 88 + insets.bottom) : 0 }}>{children}</View>
      </Animated.View>
      {/* Sticky CTA — sits above the sheet, always visible. */}
      {footer ? (
        <View
          pointerEvents="box-none"
          onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: Math.max(insets.bottom, 12),
            backgroundColor: LightColors.surface,
            shadowColor: LightColors.textPrimary,
            shadowOffset: { width: 0, height: -6 },
            shadowOpacity: 0.06,
            shadowRadius: 16,
            elevation: 28,
            zIndex: 1000,
          }}
        >
          {footer}
        </View>
      ) : null}
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
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: LightColors.dividerStrong,
  },
});
