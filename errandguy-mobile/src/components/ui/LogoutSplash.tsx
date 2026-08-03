import React from 'react';
import { Modal, View, StyleSheet } from 'react-native';
import { MotiView } from 'moti';
import { LightColors } from '../../constants/colors';
import { Wordmark } from './Wordmark';

interface LogoutSplashProps {
  visible: boolean;
  backgroundColor?: string;
  /** Deprecated: the mark is now the full-colour stacked wordmark, so a
   *  tint no longer applies. Kept for call-site compatibility. */
  logoTintColor?: string;
  /** Overall footprint of the mark. The stacked wordmark is sized by
   *  height at ~62% of this value so its two lines sit comfortably where
   *  the old square badge did. */
  logoSize?: number;
}

/**
 * Full-screen white "you've been signed out" curtain.
 *
 * Replaces the small dialog-style "Signing you out…" overlay. The
 * whole viewport whitens and the brand mark fades + lifts in, so the
 * sign-out feels like a deliberate handoff back to the start of the
 * app rather than a transient modal.
 */
export function LogoutSplash({
  visible,
  backgroundColor = LightColors.surface,
  logoSize = 156,
}: LogoutSplashProps) {
  return (
    <Modal
      visible={visible}
      transparent={false}
      statusBarTranslucent
      animationType="fade"
      // Hide the OS back-gesture during the brief curtain.
      onRequestClose={() => {}}
    >
      <View style={[styles.curtain, { backgroundColor }]}>
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 420 }}
          style={styles.brand}
        >
          {/* The loader now shows the two-tone stacked wordmark (Errand /
              Guy) rather than the square badge — matching the login hero. */}
          <Wordmark variant="stacked" height={Math.round(logoSize * 0.62)} />
        </MotiView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  curtain: {
    flex: 1,
    backgroundColor: LightColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    alignItems: 'center',
  },
});
