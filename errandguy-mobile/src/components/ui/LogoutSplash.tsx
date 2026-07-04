import React from 'react';
import { Modal, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { MotiView } from 'moti';
import { LightColors } from '../../constants/colors';

const LOGO = require('../../../assets/logo-new.png');

interface LogoutSplashProps {
  visible: boolean;
  backgroundColor?: string;
  logoTintColor?: string;
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
  logoTintColor,
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
          <Image
            source={LOGO}
            style={[
              styles.logo,
              { width: logoSize, height: logoSize },
              logoTintColor ? { tintColor: logoTintColor } : null,
            ]}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
          />
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
  logo: {
    width: 156,
    height: 156,
  },
});
