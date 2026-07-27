import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { LightColors } from '../../constants/colors';

/**
 * Full-screen brand-gradient overlay shown while a booking is being submitted.
 * A premium PROGRESS BAR (not a spinner) fills across the REAL await
 * checkpoints in book/review's handleSubmit — no fake timers:
 *
 *   checking → "Confirming your details"    (validation passed)
 *   creating → "Booking your errand"        (during createBooking)
 *   checkout → "Opening secure checkout"    (online payment, before the sheet)
 *
 * `stage = null` renders nothing. It hands straight off to book/confirm (or the
 * payment overlay), so there is deliberately no "done" stage — the bar rests
 * near-full at the hand-off rather than snapping to 100%.
 */
export type BookingStage = 'checking' | 'creating' | 'checkout';

const STAGES: { key: BookingStage; label: string; target: number; duration: number }[] = [
  // `duration` ≈ how long each stage really takes, so the fill CREEPS toward
  // its target across the actual wait (the create round-trip is the slow one)
  // — real-feeling progress instead of a snap-then-freeze.
  { key: 'checking', label: 'Confirming your details', target: 0.3, duration: 600 },
  { key: 'creating', label: 'Booking your errand', target: 0.72, duration: 6000 },
  { key: 'checkout', label: 'Opening secure checkout', target: 0.94, duration: 2200 },
];

interface BookingProgressProps {
  stage: BookingStage | null;
}

export function BookingProgress({ stage }: BookingProgressProps) {
  const [trackW, setTrackW] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!stage) return;
    const s = STAGES.find((st) => st.key === stage);
    if (!s) return;
    // Ease-out over the stage's real duration: the fill moves quickly then
    // decelerates as it nears the target, so it keeps visibly creeping through
    // the multi-second create instead of freezing at a fixed percent.
    progress.value = withTiming(s.target, { duration: s.duration, easing: Easing.out(Easing.cubic) });
  }, [stage, progress]);

  const fillStyle = useAnimatedStyle(() => ({ width: trackW * progress.value }));

  if (!stage) return null;
  const label = STAGES.find((s) => s.key === stage)?.label ?? '';

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <LinearGradient
        colors={[LightColors.gradientStart, LightColors.gradientMid, LightColors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.fill}
      >
        <View style={styles.content}>
          <Text style={styles.headline}>Getting your errand ready</Text>
          <Text style={styles.caption}>Hang tight — we're setting everything up.</Text>

          {/* Premium progress bar — fills across the real submit checkpoints. */}
          <View style={styles.barTrack} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
            <Animated.View style={[styles.barFill, fillStyle]} />
          </View>
          <Text style={styles.stageLabel}>{label}</Text>
        </View>
      </LinearGradient>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  content: { width: '100%', maxWidth: 340, alignItems: 'center' },
  headline: {
    fontFamily: 'Quicksand_700Bold',
    fontSize: 20,
    color: LightColors.textInverse,
    textAlign: 'center',
  },
  caption: {
    marginTop: 6,
    fontFamily: 'Quicksand_500Medium',
    fontSize: 13,
    color: 'rgba(255,255,255,0.82)',
    textAlign: 'center',
  },
  barTrack: {
    marginTop: 28,
    alignSelf: 'stretch',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: LightColors.textInverse,
  },
  stageLabel: {
    marginTop: 14,
    fontFamily: 'Quicksand_600SemiBold',
    fontSize: 14,
    color: LightColors.textInverse,
    textAlign: 'center',
  },
});
