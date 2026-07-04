import React from 'react';
import { Pressable, Text, View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { FacebookLogo, GoogleLogo } from './SocialLogos';
import { LightColors } from '../../constants/colors';

interface SocialLoginButtonProps {
  provider: 'google' | 'facebook';
  onPress: () => void;
  loading?: boolean;
}

// Facebook brand blue — logo asset colour only (like the four-colour
// Google "G"), never used as a UI accent.
const FACEBOOK_BRAND = '#1877F2';

/**
 * Social login button — white bordered card with logo + label
 * (reference aesthetic). Both providers share the same quiet surface
 * treatment so the pair reads as one system:
 *
 *  - Google → full-colour brand "G" mark.
 *  - Facebook → white "f" glyph inside a Facebook-blue circular chip
 *    (the glyph asset is white, so the chip paints its brand ground).
 *
 * Both variants share a 50pt height and rounded-16 corners so they read
 * as a coherent pair when laid out side-by-side.
 */
export function SocialLoginButton({
  provider,
  onPress,
  loading = false,
}: SocialLoginButtonProps) {
  const isFacebook = provider === 'facebook';

  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        pressed && { opacity: 0.85 },
      ]}
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={
        isFacebook ? 'Continue with Facebook' : 'Continue with Google'
      }
    >
      {loading ? (
        <ActivityIndicator size="small" color={LightColors.textTertiary} />
      ) : (
        <>
          <View style={[styles.logoWrap, isFacebook && styles.facebookChip]}>
            {isFacebook ? <FacebookLogo size={14} /> : <GoogleLogo size={20} />}
          </View>
          <Text style={styles.label}>
            {isFacebook ? 'Facebook' : 'Google'}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 16,
    gap: 10,
    paddingHorizontal: 14,
    backgroundColor: LightColors.surface,
    borderWidth: 1,
    borderColor: LightColors.divider,
    // Subtle elevation so the buttons read as actionable surfaces.
    ...Platform.select({
      ios: {
        shadowColor: LightColors.textPrimary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
      },
      android: { elevation: 1 },
    }),
  },
  logoWrap: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  facebookChip: {
    borderRadius: 11,
    backgroundColor: FACEBOOK_BRAND,
  },
  label: {
    fontSize: Platform.OS === 'android' ? 14 : 15,
    fontFamily: Platform.OS === 'ios' ? 'Inter_600SemiBold' : 'Quicksand_600SemiBold',
    fontWeight: '600',
    letterSpacing: -0.1,
    color: LightColors.textPrimary,
  },
});
