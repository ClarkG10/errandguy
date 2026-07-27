import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, Animated, Easing, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, X } from 'lucide-react-native';
import type { BookingStatus } from '../../types';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { LightColors, Elevation } from '../../constants/colors';

/**
 * Premium horizontal "journey beads" — a single refined progress rail that
 * replaces the verbose vertical StatusTimeline. Design language:
 *
 *   • A rounded rail whose FILLED portion is a soft brand gradient with
 *     rounded caps (not a flat hairline), so progress reads as a polished
 *     bar rather than a thin line.
 *   • Beads sit on the rail: completed = small solid dot, upcoming = hollow
 *     ring, the ACTIVE bead is a layered "gem" — a breathing glow halo + a
 *     lifted white core + a tinted center — so the current step feels alive
 *     and premium without noisy per-bead labels.
 *   • Terminal states get first-class treatment: COMPLETED fills green with a
 *     check on the final bead; CANCELLED greys the whole path with a red stop
 *     (X) at the end, so it reads "journey ended", never "completed".
 *   • A glanceable counter ("03 / 06", or DONE / ENDED) sits at the right end.
 *
 * Performance discipline is preserved from the original: the only animation
 * is a NATIVE-driver opacity pulse on the active halo — no layout animation,
 * no setState — so the rail stays smooth while the host screen runs live GPS,
 * polling and chat.
 */

type Phase = {
  status: BookingStatus;
  short: string; // 1–2 word label shown ONLY when active
};

const PHASES: Phase[] = [
  { status: 'pending', short: 'Finding' },
  { status: 'accepted', short: 'Accepted' },
  { status: 'heading_to_pickup', short: 'En route' },
  { status: 'picked_up', short: 'Picked up' },
  { status: 'in_transit', short: 'In transit' },
  { status: 'completed', short: 'Done' },
];

/**
 * Map every backend status to one of the six visible beads. Mid-step variants
 * (matched, arrived_at_pickup, …) collapse upward to keep the bar uncluttered
 * while the screen-level hero still shows the precise label.
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

type Accent = 'brand' | 'danger' | 'success';

interface JourneyBeadsProps {
  status: BookingStatus;
  /**
   * Optional accent override. When omitted it is derived from status
   * (completed → success, cancelled → danger, else brand), so callers that
   * only pass `status` still get correct terminal colouring.
   */
  accent?: Accent;
  onPress?: () => void;
  /**
   * Render the small active-phase caption under the rail. Defaults to true.
   * Pass `false` when the surrounding screen already shows the current step in
   * a hero — otherwise the two tiny uppercase captions read as clutter.
   */
  showLabel?: boolean;
}

const TRACK_HEIGHT = 16;
const RAIL = 3;

export function JourneyBeads({ status, accent, onPress, showLabel = true }: JourneyBeadsProps) {
  const activeIdx = STATUS_TO_PHASE_INDEX[status] ?? 0;
  const reduceMotion = useReducedMotion();

  const isCancelled = status === 'cancelled';
  const isComplete = status === 'completed' || status === 'delivered';
  const isTerminal = isCancelled || isComplete;

  // Effective tone: explicit prop wins, else derived from status.
  const tone: Accent = accent ?? (isCancelled ? 'danger' : isComplete ? 'success' : 'brand');

  // Colour rungs. Cancelled greys the whole traversed path (a stopped journey
  // must not read as a finished one) and puts the danger accent only on the
  // final stop bead.
  const activeColor =
    tone === 'danger' ? LightColors.danger : tone === 'success' ? LightColors.success : LightColors.primary;
  const completedColor = isCancelled ? LightColors.dividerStrong : activeColor;
  const railFill: [string, string] = isCancelled
    ? [LightColors.dividerStrong, LightColors.dividerStrong]
    : tone === 'success'
      ? [LightColors.success, LightColors.success]
      : [LightColors.primary, LightColors.primary400];

  // Breathing halo on the active bead — native-driver opacity ONLY (no layout
  // work), frozen on terminal states and under Reduce Motion.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion || isTerminal) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion, isTerminal]);

  const total = PHASES.length;
  const activePhase = PHASES[activeIdx];
  const fillPct = (activeIdx / (total - 1)) * 100;
  const counter = useMemo(() => {
    if (isCancelled) return 'ENDED';
    if (isComplete) return 'DONE';
    return `${String(activeIdx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  }, [activeIdx, total, isCancelled, isComplete]);

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
      <View className="px-1 pt-1 pb-1.5">
        <View className="flex-row items-center">
          <View className="flex-1">
            <View className="relative justify-center" style={{ height: TRACK_HEIGHT }}>
              {/* Rail — background groove */}
              <View
                style={{
                  position: 'absolute',
                  left: 3,
                  right: 3,
                  top: '50%',
                  marginTop: -RAIL / 2,
                  height: RAIL,
                  borderRadius: RAIL,
                  backgroundColor: LightColors.divider,
                }}
              />
              {/* Rail — filled portion (soft gradient, rounded caps) */}
              {fillPct > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    left: 3,
                    top: '50%',
                    marginTop: -RAIL / 2,
                    height: RAIL,
                    width: `${fillPct}%`,
                    borderRadius: RAIL,
                    overflow: 'hidden',
                  }}
                >
                  <LinearGradient
                    colors={railFill}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ flex: 1 }}
                  />
                </View>
              )}

              {/* Beads */}
              <View className="flex-row items-center justify-between">
                {PHASES.map((p, i) => {
                  const done = i < activeIdx;
                  const isActive = i === activeIdx;

                  // Active bead — terminal: solid disc with a check / stop mark.
                  if (isActive && isTerminal) {
                    return (
                      <View
                        key={p.status}
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 8,
                          backgroundColor: activeColor,
                          alignItems: 'center',
                          justifyContent: 'center',
                          ...Elevation.sm,
                        }}
                      >
                        {isComplete ? (
                          <Check size={10} color={LightColors.textInverse} strokeWidth={3} />
                        ) : (
                          <X size={10} color={LightColors.textInverse} strokeWidth={3} />
                        )}
                      </View>
                    );
                  }

                  // Active bead — live: layered "gem" with a breathing halo.
                  if (isActive) {
                    return (
                      <View
                        key={p.status}
                        style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Animated.View
                          style={{
                            position: 'absolute',
                            width: 18,
                            height: 18,
                            borderRadius: 9,
                            backgroundColor: activeColor,
                            opacity: reduceMotion
                              ? 0.18
                              : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.36] }),
                          }}
                        />
                        <View
                          style={{
                            width: 13,
                            height: 13,
                            borderRadius: 6.5,
                            backgroundColor: LightColors.surface,
                            alignItems: 'center',
                            justifyContent: 'center',
                            ...Elevation.sm,
                          }}
                        >
                          <View
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: 3.5,
                              backgroundColor: activeColor,
                            }}
                          />
                        </View>
                      </View>
                    );
                  }

                  // Completed / upcoming beads.
                  return (
                    <View
                      key={p.status}
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: done ? completedColor : LightColors.surface,
                        borderWidth: done ? 0 : 1.5,
                        borderColor: LightColors.dividerStrong,
                      }}
                    />
                  );
                })}
              </View>
            </View>
          </View>

          {/* Counter — typographic, tabular so it never shifts width. */}
          <Text
            className="ml-3 text-[11px] font-montserrat-bold"
            style={{
              letterSpacing: 1,
              fontVariant: ['tabular-nums'],
              color: isTerminal ? activeColor : LightColors.textSecondary,
            }}
            maxFontSizeMultiplier={1.3}
          >
            {counter}
          </Text>
        </View>

        {/* Active-phase caption — anchored roughly under its own bead. Hidden on
            terminal states (the screen hero carries the outcome) and when the
            host opts out via showLabel={false}. */}
        {showLabel && !isTerminal && (
          <View className="mt-1.5 flex-row">
            <View style={{ width: `${fillPct}%` }} />
            <Text
              className="text-[11px] font-montserrat-bold uppercase"
              style={{ color: activeColor, letterSpacing: 1.4, transform: [{ translateX: -8 }] }}
              maxFontSizeMultiplier={1.3}
            >
              {activePhase.short}
            </Text>
          </View>
        )}
      </View>
    </Wrapper>
  );
}
