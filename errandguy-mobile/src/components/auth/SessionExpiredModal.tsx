import React, { useEffect } from 'react';
import { View, Text, Modal, StyleSheet, AccessibilityInfo, Platform } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { Clock } from 'lucide-react-native';
import { Button } from '../ui/Button';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { DraftBooking } from '../../stores/bookingStore';

/** True when a booking draft holds something the person typed or picked. */
export function hasBookingDraft(draft: DraftBooking | null | undefined): boolean {
  if (!draft) return false;
  return !!(
    draft.errand_type_id ||
    draft.pickup_address ||
    draft.dropoff_address ||
    (draft.description && draft.description.trim()) ||
    (draft.shoppingItems && draft.shoppingItems.length > 0) ||
    (draft.stops && draft.stops.length > 0)
  );
}

/** The body copy — the draft line only when there really is a draft. */
export function sessionExpiredBody(draftSaved: boolean): string {
  return draftSaved
    ? 'For your security we signed you out. Your errand draft is saved.'
    : 'For your security we signed you out.';
}

interface SessionExpiredModalProps {
  visible: boolean;
  /** A booking draft survived the sign-out (bookingStore keeps it). */
  draftSaved: boolean;
  onContinue: () => void;
}

/**
 * Pattern 8 (session expired): a calm card over the dimmed sign-in screen
 * after a 401 ended the session. It says what happened, reassures that the
 * errand draft is kept (only when one exists), and has one way forward.
 */
export function SessionExpiredModal({ visible, draftSaved, onContinue }: SessionExpiredModalProps) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const body = sessionExpiredBody(draftSaved);

  useEffect(() => {
    if (!visible) {
      progress.value = 0;
      return;
    }
    progress.value = reduceMotion
      ? 1
      : withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
    // VoiceOver gets the whole message, not just the focus jump.
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(`You were signed out. ${body}`);
    }
  }, [visible, reduceMotion, progress, body]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.96 + 0.04 * progress.value }],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      // Android back = the same as the button: dismiss to the sign-in form.
      onRequestClose={onContinue}
    >
      <View style={s.backdrop}>
        <Animated.View
          style={[s.card, cardStyle]}
          accessibilityViewIsModal
          testID="session-expired-modal"
        >
          <View style={s.circle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Clock size={34} color={LightColors.primary} strokeWidth={1.9} />
          </View>
          <Text style={s.title} accessibilityRole="header">
            You were signed out
          </Text>
          <Text style={s.body}>{body}</Text>
          <View style={s.action}>
            <Button title="Sign in and continue" size="lg" fullWidth onPress={onContinue} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: `${LightColors.ink}80`,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    borderRadius: Radius.modal,
    backgroundColor: LightColors.surface,
  },
  circle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: LightColors.primary50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: 18,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    textAlign: 'center',
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textPrimary,
  },
  body: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textSecondary,
  },
  action: { alignSelf: 'stretch', marginTop: 22 },
});
