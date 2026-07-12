import React from 'react';
import { Pressable, Text, View, StyleSheet, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { FacebookLogo, GoogleLogo } from './SocialLogos';
import { LightColors } from '../../constants/colors';
import { Spinner } from '../ui/Spinner';

interface SocialLoginButtonProps {
  provider: 'google' | 'facebook';
  onPress: () => void;
  loading?: boolean;
  /** Small status pill rendered after the label (e.g. "Soon") so users
   *  can see an unavailable provider before tapping into a dead end. */
  badge?: string;
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
  badge,
}: SocialLoginButtonProps) {
  const isFacebook = provider === 'facebook';

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        // 0.85 was imperceptible on a white card — 0.7 matches the
        // press weight of the app's Button idiom.
        pressed && { opacity: 0.7 },
      ]}
      android_ripple={{ color: `${LightColors.primary}14`, borderless: false }}
      onPress={handlePress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={
        isFacebook ? 'Continue with Facebook' : 'Continue with Google'
      }
      accessibilityHint={badge ? 'Coming soon' : undefined}
    >
      {loading ? (
        <Spinner size="small" color={LightColors.textTertiary} />
      ) : (
        // Fixed-size logo slot + a single uniform gap so the two buttons
        // read as a matched pair: both glyphs occupy an identical 20×20 box
        // and the label/badge spacing is the same on each. (Previously the
        // Google mark was 20 while the Facebook glyph sat in an 11-radius
        // chip, and the badge had a negative margin — so the logos landed
        // at different offsets and the pair looked misaligned.)
        <>
          <View style={[styles.logoWrap, isFacebook && styles.facebookChip]}>
            {isFacebook ? <FacebookLogo size={13} /> : <GoogleLogo size={19} />}
          </View>
          <Text style={styles.label}>
            {isFacebook ? 'Facebook' : 'Google'}
          </Text>
          {badge ? <Text style={styles.badge}>{badge}</Text> : null}
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
    height: 46,
    borderRadius: 12,
    gap: 8,
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
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  facebookChip: {
    borderRadius: 10,
    backgroundColor: FACEBOOK_BRAND,
  },
  label: {
    fontSize: 14,
    // System-font remap turns this into SF Pro / Roboto at weight 600 on
    // both platforms, so the pair reads identically cross-platform.
    fontFamily: 'Inter_600SemiBold',
    fontWeight: '600',
    letterSpacing: -0.1,
    color: LightColors.textPrimary,
  },
  badge: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: LightColors.textTertiary,
    backgroundColor: LightColors.surfaceMuted,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    // Text on iOS needs overflow hidden for the pill radius to clip.
    overflow: 'hidden',
    // No negative margin — the button's uniform `gap` sets spacing so the
    // badge sits the same distance from the label as the logo does.
  },
});
