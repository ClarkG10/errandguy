import React from 'react';
import { Pressable, Text, View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { FacebookLogo, GoogleLogo } from './SocialLogos';

interface SocialLoginButtonProps {
  provider: 'google' | 'facebook';
  onPress: () => void;
  loading?: boolean;
}

/**
 * Modern social login button.
 *
 * Two visual treatments:
 *  - Google → white surface, hairline border, full-color G logo. Mirrors
 *    Google's own brand guidelines for "Sign in with Google".
 *  - Facebook → solid Facebook blue (#1877F2) background with a white
 *    "f" mark and white label, matching Meta's "Continue with Facebook"
 *    styling.
 *
 * Both variants share a 50pt height and rounded-12 corners so they read
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
        isFacebook ? styles.facebook : styles.google,
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
        <ActivityIndicator
          size="small"
          color={isFacebook ? '#FFFFFF' : '#64748B'}
        />
      ) : (
        <>
          <View style={styles.logoWrap}>
            {isFacebook ? <FacebookLogo size={20} /> : <GoogleLogo size={20} />}
          </View>
          <Text
            style={[
              styles.label,
              { color: isFacebook ? '#FFFFFF' : '#0F172A' },
            ]}
          >
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
    borderRadius: 12,
    gap: 10,
    paddingHorizontal: 14,
    // Subtle elevation so the buttons read as actionable surfaces.
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
      },
      android: { elevation: 1 },
    }),
  },
  google: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  facebook: {
    backgroundColor: '#1877F2',
  },
  logoWrap: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: Platform.OS === 'android' ? 14 : 15,
    fontFamily: Platform.OS === 'ios' ? 'Inter_600SemiBold' : 'Quicksand_600SemiBold',
    fontWeight: '600',
    letterSpacing: -0.1,
  },
});
