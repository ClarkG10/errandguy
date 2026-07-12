import React from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Check } from 'lucide-react-native';
import { Spinner } from '../ui/Spinner';
import { LightColors } from '../../constants/colors';

/**
 * Full-screen brand-gradient overlay shown while a booking is being submitted,
 * replacing the in-button dots with a staged checklist. Driven off the REAL
 * await checkpoints in book/review's handleSubmit (no timers):
 *
 *   checking → "Checking your details"     (validation passed)
 *   creating → "Creating your errand"      (during createBooking)
 *   checkout → "Opening secure checkout"   (only for online payment, before the
 *                                           Xendit sheet)
 *
 * Steps are revealed progressively: everything before the current stage shows
 * a check, the current stage shows a spinner. It deliberately has NO
 * "finding runner"/"done" stage — that IS the next screen (book/confirm), which
 * this hands straight off to. `stage = null` renders nothing.
 */
export type BookingStage = 'checking' | 'creating' | 'checkout';

const STEPS: { key: BookingStage; label: string }[] = [
  { key: 'checking', label: 'Checking your details' },
  { key: 'creating', label: 'Creating your errand' },
  { key: 'checkout', label: 'Opening secure checkout' },
];

interface BookingProgressProps {
  stage: BookingStage | null;
}

export function BookingProgress({ stage }: BookingProgressProps) {
  if (!stage) return null;
  const currentIndex = STEPS.findIndex((s) => s.key === stage);
  const visible = STEPS.slice(0, Math.max(0, currentIndex) + 1);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <LinearGradient
        colors={[LightColors.gradientStart, LightColors.gradientMid, LightColors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.fill}
      >
        <View style={styles.content}>
          <Text style={styles.headline}>Setting up your errand</Text>
          <Text style={styles.caption}>Hang tight — this only takes a moment.</Text>

          <View style={styles.steps}>
            {visible.map((step, i) => {
              const done = i < currentIndex;
              return (
                <View key={step.key} style={styles.row}>
                  <View style={styles.indicator}>
                    {done ? (
                      <View style={styles.doneDisc}>
                        <Check size={14} color={LightColors.primary} strokeWidth={3} />
                      </View>
                    ) : (
                      <Spinner kind="brand" size="small" color={LightColors.textInverse} />
                    )}
                  </View>
                  <Text style={[styles.label, done && styles.labelDone]}>{step.label}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </LinearGradient>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  content: { width: '100%', maxWidth: 360, alignItems: 'center' },
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
  steps: { marginTop: 28, alignSelf: 'stretch', gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  indicator: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  doneDisc: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: LightColors.textInverse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: 'Quicksand_600SemiBold',
    fontSize: 15,
    color: LightColors.textInverse,
  },
  labelDone: { color: 'rgba(255,255,255,0.7)' },
});
