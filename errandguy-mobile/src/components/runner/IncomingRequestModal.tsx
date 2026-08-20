import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  Animated,
  Easing,
  Platform,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { MotiView } from 'moti';
import type { LucideIcon } from 'lucide-react-native';
import { MapPin, Navigation, Truck, ShoppingBag } from 'lucide-react-native';
import { Button } from '../ui/Button';
import { PickupDistanceLine } from './PickupDistanceLine';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatRunnerPayout } from '../../utils/runnerPayout';
import { formatDistanceKm } from '../../utils/formatDistance';
import { getErrandTypeRule } from '../../constants/errandTypeRules';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { toast } from '../../stores/toastStore';
import type { Booking } from '../../types';
import { LightColors } from '../../constants/colors';

interface IncomingRequestModalProps {
  booking: Booking;
  onAccept: () => void | Promise<void>;
  onDecline: () => void | Promise<void>;
  timeoutSeconds?: number;
}

// Category chip — lucide glyph + label, replacing the old emoji-prefixed
// badges (emoji render inconsistently across Android OEMs and can't be
// tokenized). Text sits on a soft wash in the *Dark rung for AA.
function TypeChip({
  Icon,
  label,
  bg,
  fg,
}: {
  Icon: LucideIcon;
  label: string;
  bg: string;
  fg: string;
}) {
  return (
    <View
      className="flex-row items-center gap-1 rounded-full px-2.5 py-1"
      style={{ backgroundColor: bg }}
    >
      <Icon size={13} color={fg} strokeWidth={2} />
      <Text className="text-[12px] font-montserrat-bold" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}

// Ring geometry — a genuinely depleting arc (strokeDashoffset sweep) so a
// glancing runner reads "time draining", not "a colour fading out".
const RING = 84;
const RING_STROKE = 6;
const RING_R = (RING - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_R;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function IncomingRequestModal({
  booking,
  onAccept,
  onDecline,
  timeoutSeconds = 30,
}: IncomingRequestModalProps) {
  const [remaining, setRemaining] = useState(timeoutSeconds);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const reduceMotion = useReducedMotion();

  const errandRule = getErrandTypeRule(booking.errand_type?.slug);
  const isSingleLocation = errandRule.singleLocation;
  const isShopping = errandRule.requiresShoppingBudget;
  const showDropoff =
    !isSingleLocation &&
    !!booking.dropoff_address &&
    booking.dropoff_address !== booking.pickup_address;

  useEffect(() => {
    // Attention grab the moment the modal mounts. expo-haptics replaces
    // the old raw Vibration pattern — it maps to the platform haptic
    // engine (crisper on iOS, consistent on Android) and safely no-ops
    // when the app is backgrounded, so no AppState bookkeeping needed.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  }, []);

  useEffect(() => {
    if (accepting || declining) return;
    if (remaining <= 0) {
      // Auto-decline honesty: the offer didn't vanish because of a bug or
      // a fumble — the window simply closed. Say so before it disappears.
      toast.info('Time’s up — that request went to another runner.');
      onDecline();
      return;
    }
    // Escalating urgency as the window closes: a warning buzz when 10s
    // are left, then a heavy tick every second inside the final 5s.
    if (remaining === 10) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    } else if (remaining <= 5) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    }
    const timer = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, onDecline, accepting, declining]);

  const handleAccept = useCallback(async () => {
    if (accepting || declining) return;
    setAccepting(true);
    try {
      await onAccept();
    } finally {
      // Parent unmounts the modal on success; reset only if still mounted.
      setAccepting(false);
    }
  }, [onAccept, accepting, declining]);

  const handleDecline = useCallback(async () => {
    if (accepting || declining) return;
    setDeclining(true);
    // Distinct, quieter cue than the accept path (whose success haptic
    // is fired by the parent at the server-confirm point).
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await onDecline();
    } finally {
      setDeclining(false);
    }
  }, [onDecline, accepting, declining]);

  const progress = Math.max(0, remaining / timeoutSeconds);
  // *Dark amber rung so the number/arc clear AA in the 10s window; base
  // amber (#F59E0B) is only ~1.9:1 and fails even the large-text 3:1 floor.
  const urgencyColor =
    remaining <= 5
      ? LightColors.danger
      : remaining <= 10
      ? LightColors.warningDark
      : LightColors.primary;

  // Ring sweeps smoothly between the 1s ticks so it reads as continuous
  // depletion rather than a stepped jump. strokeDashoffset can't run on
  // the native driver, so this View animates off-thread — kept cheap.
  const progressAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 950,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [progress, progressAnim]);
  const dashoffset = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [RING_CIRC, 0],
  });

  // Non-colour urgency: a heartbeat scale on the ring through the final
  // 5s so criticality is felt, not just tinted. Frozen under Reduce Motion.
  const critical = remaining <= 5 && remaining > 0;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion || !critical) {
      pulseAnim.stopAnimation(() => pulseAnim.setValue(1));
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [critical, reduceMotion, pulseAnim]);

  // Screen-reader countdown announcement, updated at coarse 5s buckets —
  // per-second label churn would make VoiceOver/TalkBack chatter over
  // the errand details the runner actually needs to hear.
  const coarseRemaining = Math.max(5, Math.ceil(remaining / 5) * 5);
  const timerLabel =
    remaining <= 5
      ? `${remaining} seconds left to respond`
      : `About ${coarseRemaining} seconds left to respond`;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      // Android back captures to the screen for the offer's lifetime, and
      // maps to a deliberate decline rather than a silent nav-away.
      onRequestClose={handleDecline}
    >
      <View
        className="flex-1 bg-black/60 justify-center items-center px-6"
        accessibilityViewIsModal
      >
        <MotiView
          // Reduce-Motion: swap the scale+translate spring for a plain
          // opacity fade so the offer card doesn't bounce in on every
          // incoming request (mirrors the heartbeat pulse already gated below).
          from={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92, translateY: 12 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, translateY: 0 }}
          transition={
            reduceMotion
              ? { type: 'timing', duration: 120 }
              : { type: 'spring', damping: 22, stiffness: 240, mass: 0.8 }
          }
          className="bg-background w-full max-w-sm overflow-hidden"
          style={{ borderRadius: 24, maxHeight: '88%' }}
        >
          {/* Body scrolls under large Dynamic Type so the pinned actions
              below always stay reachable on a short (SE) screen. */}
          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 28, paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* Countdown ring — depleting arc + large tabular number. */}
            <View
              className="items-center mb-4"
              accessible
              accessibilityLabel={timerLabel}
              accessibilityLiveRegion="polite"
            >
              <Animated.View
                style={{
                  width: RING,
                  height: RING,
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: [{ scale: pulseAnim }],
                }}
              >
                <Svg
                  width={RING}
                  height={RING}
                  style={{ position: 'absolute' }}
                >
                  <Circle
                    cx={RING / 2}
                    cy={RING / 2}
                    r={RING_R}
                    stroke={LightColors.divider}
                    strokeWidth={RING_STROKE}
                    fill="none"
                  />
                  <AnimatedCircle
                    cx={RING / 2}
                    cy={RING / 2}
                    r={RING_R}
                    stroke={urgencyColor}
                    strokeWidth={RING_STROKE}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={RING_CIRC}
                    strokeDashoffset={dashoffset}
                    transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
                  />
                </Svg>
                <Text
                  className="font-inter-semi tabular-nums"
                  style={{ fontSize: 34, lineHeight: 38, color: urgencyColor }}
                >
                  {remaining}
                </Text>
              </Animated.View>
              <Text className="text-xs font-montserrat text-textSecondary mt-2">
                seconds to respond
              </Text>
            </View>

            {/* Errand Type + category chips (lucide, not emoji). */}
            <View className="flex-row items-center flex-wrap gap-2 mb-3">
              <Text className="text-base font-montserrat-bold text-textPrimary">
                {booking.errand_type?.name ?? 'New Errand'}
              </Text>
              {booking.is_transportation && (
                <TypeChip
                  Icon={Truck}
                  label="Transport"
                  bg={LightColors.primarySoft}
                  fg={LightColors.primaryDark}
                />
              )}
              {isShopping && (
                <TypeChip
                  Icon={ShoppingBag}
                  label="Shopping"
                  bg={LightColors.dangerSoft}
                  fg={LightColors.dangerDark}
                />
              )}
              {isSingleLocation && (
                <TypeChip
                  Icon={MapPin}
                  label="On-site"
                  bg={LightColors.surfaceMuted}
                  fg={LightColors.textSecondary}
                />
              )}
            </View>

            {/* Addresses — hide dropoff for on-site / single-location errands. */}
            <View className="mb-3">
              <View className="flex-row items-start gap-2 mb-1">
                <MapPin size={14} color={LightColors.success} />
                <Text className="text-xs font-montserrat text-textSecondary flex-1" numberOfLines={2}>
                  {booking.pickup_address}
                </Text>
              </View>
              {showDropoff && (
                <View className="flex-row items-start gap-2">
                  <Navigation size={14} color={LightColors.danger} />
                  <Text className="text-xs font-montserrat text-textSecondary flex-1" numberOfLines={2}>
                    {booking.dropoff_address}
                  </Text>
                </View>
              )}
            </View>

            {/* Shopping Budget banner — runner needs to know spend ceiling before accepting. */}
            {isShopping && booking.shopping_budget != null && (
              <View className="flex-row items-center gap-2 bg-warningSoft border border-warning/40 rounded-xl p-2.5 mb-3">
                <ShoppingBag size={14} color={LightColors.warning} />
                <Text className="text-xs font-montserrat text-warningDark flex-1">
                  Customer budget cap
                </Text>
                <Text className="text-sm font-inter-semi tabular-nums text-warningDark">
                  {formatCurrency(booking.shopping_budget)}
                </Text>
              </View>
            )}

            {/* Distance + Payout — the most important number on the modal,
                given the slate fintech treatment so it visually wins. */}
            <View
              className="flex-row items-center justify-between rounded-xl p-3 overflow-hidden"
              style={{ backgroundColor: LightColors.textPrimary }}
            >
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: -30,
                  right: -20,
                  width: 90,
                  height: 90,
                  borderRadius: 45,
                  backgroundColor: LightColors.primary,
                  opacity: 0.22,
                }}
              />
              <View className="flex-row items-center gap-1.5">
                <Truck size={14} color={LightColors.textInverse} />
                <Text className="text-xs font-inter tabular-nums text-white/80">
                  {formatDistanceKm(booking.distance_km) ?? 'On-site'}
                </Text>
              </View>
              <Text className="text-xl font-inter-semi tabular-nums text-white">
                {formatRunnerPayout(booking.runner_payout)}
              </Text>
            </View>

            {/* How far the *pickup* is from the runner right now — the key
                accept signal, distinct from the trip distance above. Hides
                itself when live location is unavailable. */}
            <View className="mt-2">
              <PickupDistanceLine booking={booking} />
            </View>

            {booking.is_transportation && (
              // warningDark rung — this safety string is illegible in base amber.
              <Text className="text-xs font-montserrat text-warningDark text-center mt-3">
                PIN verification required before ride starts
              </Text>
            )}
          </ScrollView>

          {/* Actions — pinned below the scroll. Wider separation (16px) and
              a quiet ghost Decline so a rushed thumb overshooting Accept
              doesn't reject a paid job. */}
          <View style={{ paddingHorizontal: 28, paddingTop: 4, paddingBottom: 28, gap: 16 }}>
            <Button
              title="Accept"
              onPress={handleAccept}
              disabled={accepting || declining}
              loading={accepting}
              loadingTitle="Accepting…"
              fullWidth
            />
            <Button
              title="Decline"
              variant="ghost"
              onPress={handleDecline}
              disabled={accepting || declining}
              fullWidth
            />
          </View>
        </MotiView>
      </View>
    </Modal>
  );
}
