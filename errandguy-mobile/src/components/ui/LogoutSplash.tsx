import React from 'react';
import { Modal, View, Text, Image, StyleSheet, Platform } from 'react-native';
import { MotiView } from 'moti';

const MASCOT = require('../../../assets/mascot.png');

interface LogoutSplashProps {
  visible: boolean;
}

/**
 * Full-screen white "you've been signed out" curtain.
 *
 * Replaces the small dialog-style "Signing you out…" overlay. The
 * whole viewport whitens and the brand mark fades + lifts in, so the
 * sign-out feels like a deliberate handoff back to the start of the
 * app rather than a transient modal.
 */
export function LogoutSplash({ visible }: LogoutSplashProps) {
  return (
    <Modal
      visible={visible}
      transparent={false}
      statusBarTranslucent
      animationType="fade"
      // Hide the OS back-gesture during the brief curtain.
      onRequestClose={() => {}}
    >
      <View style={styles.curtain}>
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 420 }}
          style={styles.brand}
        >
          <Image source={MASCOT} style={styles.mascot} resizeMode="contain" />
          <Text style={styles.wordmark}>ErrandGuy</Text>
        </MotiView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  curtain: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    alignItems: 'center',
  },
  mascot: {
    width: 96,
    height: 96,
    marginBottom: 14,
  },
  wordmark: {
    fontSize: Platform.OS === 'android' ? 22 : 24,
    fontFamily: Platform.OS === 'ios' ? 'Inter_700Bold' : 'Quicksand_700Bold',
    color: '#0F172A',
    letterSpacing: -0.4,
  },
});
