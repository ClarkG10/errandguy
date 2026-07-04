import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, Animated, Easing, Pressable } from 'react-native';
import type { BookingStatus } from '../../types';
import { LightColors } from '../../constants/colors';

/**
 * Distinctive horizontal "journey beads" — replaces the verbose vertical
 * StatusTimeline. The layout is intentionally NOT a typical stepper:
 *
 *   • A single thin horizontal track stretches the full width.
 *   • Each phase is a small bead on the track. Completed beads are
 *     filled, the active bead is filled + breathing-pulse animated,
 *     upcoming beads are hollow rings.
 *   • Phase labels are NOT rendered under every bead (which would be
 *     visually noisy on phones). Only the active phase's label appears,
 *     anchored under its bead, in a typographic style — uppercase,
 *     wide-tracked, small — so it reads as a section caption rather
 *     than a button.
 *   • A short numeric counter ("03 / 06") sits at the right end as a
 *     glanceable "where am I in this journey" hint.
 *
 * The component is purely visual — no buttons, no callbacks. The screen
 * supplies the active status and we work out everything else.
 */

type Phase = {
  status: BookingStatus;
  short: string; // 1–2 word label shown ONLY when active
};

/**
 * The canonical happy-path sequence. Errand types that skip steps (e.g.
 * a pure delivery without an "arrived_at_dropoff" beat) are still
 * mapped onto the closest matching bead so the strip stays the same
 * width across booking types — no janky resize when the runner moves
 * forward.
 */
const PHASES: Phase[] = [
  { status: 'pending', short: 'Finding' },
  { status: 'accepted', short: 'Accepted' },
  { status: 'heading_to_pickup', short: 'En route' },
  { status: 'picked_up', short: 'Picked up' },
  { status: 'in_transit', short: 'In transit' },
  { status: 'completed', short: 'Done' },
];

/**
 * Map every backend status to one of the six visible beads. Mid-step
 * variants (matched, arrived_at_pickup, …) collapse upward to keep the
 * bar uncluttered while the screen-level "current step" hero still
 * shows the precise label.
 */
const STATUS_TO_PHASE_INDEX: Record<BookingStatus, number> = {
  pending: 0,
  no_runner: 0,
  matched: 1,
  accepted: 1,
  heading_to_pickup: 2,
  arrived_at_pickup: 2,
  picked_up: 3,
  in_transit: 4,
  arrived_at_dropoff: 4,
  delivered: 5,
  completed: 5,
  cancelled: 5,
};

interface JourneyBeadsProps {
  status: BookingStatus;
  /**
   * Optional accent. When the booking is cancelled we tint the active
   * bead red instead of the default brand blue so the strip carries the
   * "this trip ended unhappily" signal even if the screen scrolls the
   * detail card off.
   */
  accent?: 'brand' | 'danger';
  onPress?: () => void;
  /**
   * Render the small "EN ROUTE" caption under the active bead. Defaults
   * to true. Pass `false` when the surrounding screen already shows the
   * current step in a hero (e.g. `CurrentStepHero`) — otherwise the two
   * tiny uppercase captions stack on top of each other and read as one
   * cluttered block.
   */
  showLabel?: boolean;
}

export function JourneyBeads({ status, accent = 'brand', onPress, showLabel = true }: JourneyBeadsProps) {
  const activeIdx = STATUS_TO_PHASE_INDEX[status] ?? 0;

  // Pulse animation for the active bead. We deliberately drive only an
  // OPACITY interpolation on a NATIVE driver so the animation runs on
  // the UI thread and never causes JS-side reflows when the rest of the
  // screen is busy (live GPS, polling, chat). No setState anywhere.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (status === 'completed' || status === 'cancelled') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, status]);

  const activeColor = accent === 'danger' ? LightColors.danger : LightColors.primary;
  const activePhase = PHASES[activeIdx];
  const counter = useMemo(
    () => `${String(activeIdx + 1).padStart(2, '0')} / ${String(PHASES.length).padStart(2, '0')}`,
    [activeIdx],
  );

  const Wrapper: React.ComponentType<{ children: React.ReactNode }> = ({ children }) =>
    onPress ? (
      <Pressable onPress={onPress} accessibilityRole="button" hitSlop={6}>
        {children}
      </Pressable>
    ) : (
      <View>{children}</View>
    );

  return (
    <Wrapper>
      <View className="px-1 pt-1 pb-2">
        {/* Top row: the track + beads, with the counter floated right. */}
        <View className="flex-row items-center">
          <View className="flex-1">
            <View className="relative h-3 justify-center">
              {/* Track */}
              <View
                className="absolute left-0 right-0 h-[2px] bg-divider"
                style={{ top: '50%', marginTop: -1 }}
              />
              {/* Filled portion up to and including the active bead. */}
              <View
                className="absolute left-0 h-[2px]"
                style={{
                  top: '50%',
                  marginTop: -1,
                  width: `${(activeIdx / (PHASES.length - 1)) * 100}%`,
                  backgroundColor: activeColor,
                }}
              />
              {/* Beads */}
              <View className="flex-row items-center justify-between">
                {PHASES.map((p, i) => {
                  const isCompleted = i < activeIdx;
                  const isActive = i === activeIdx;
                  const baseSize = isActive ? 12 : 8;

                  if (isActive) {
                    return (
                      <View key={p.status} style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}>
                        {/* Pulsing halo. Native-driver opacity only — no
                            layout work, so the rest of the screen
                            (map, GPS pin) animates without contention. */}
                        <Animated.View
                          style={{
                            position: 'absolute',
                            width: 22,
                            height: 22,
                            borderRadius: 11,
                            backgroundColor: activeColor,
                            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.28] }),
                          }}
                        />
                        <View
                          style={{
                            width: baseSize,
                            height: baseSize,
                            borderRadius: baseSize / 2,
                            backgroundColor: activeColor,
                          }}
                        />
                      </View>
                    );
                  }

                  return (
                    <View
                      key={p.status}
                      style={{
                        width: baseSize,
                        height: baseSize,
                        borderRadius: baseSize / 2,
                        backgroundColor: isCompleted ? activeColor : 'transparent',
                        borderWidth: isCompleted ? 0 : 1.5,
                        borderColor: LightColors.dividerStrong,
                      }}
                    />
                  );
                })}
              </View>
            </View>
          </View>
          {/* Counter — typographic, no box. Reads as a caption. */}
          <Text
            className="ml-3 text-[10px] font-montserrat-semi text-textSecondary"
            style={{ letterSpacing: 1.2 }}
          >
            {counter}
          </Text>
        </View>

        {/* Active phase label — uppercase, tracked, anchored under the
            track. We compute its left offset from activeIdx so it sits
            (roughly) under its own bead instead of always centered.
            Suppressed when the host screen already renders a step
            headline (CurrentStepHero) — otherwise two stacked tiny
            captions read as cluttered text. */}
        {showLabel && (
          <View className="mt-1.5 flex-row">
            <View
              style={{
                width: `${(activeIdx / (PHASES.length - 1)) * 100}%`,
              }}
            />
            <Text
              className="text-[10px] font-montserrat-bold uppercase"
              style={{
                color: activeColor,
                letterSpacing: 1.4,
                transform: [{ translateX: -8 }],
              }}
            >
              {activePhase.short}
            </Text>
          </View>
        )}
      </View>
    </Wrapper>
  );
}
