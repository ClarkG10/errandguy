import React from 'react';
import { Pressable, Text, View, ActivityIndicator, StyleSheet, Platform } from 'react-native';

interface SocialLoginButtonProps {
  provider: 'google' | 'facebook';
  onPress: () => void;
  loading?: boolean;
}

const providerConfig = {
  google: {
    label: 'Google',
    letter: 'G',
    accentColor: '#4285F4',
  },
  facebook: {
    label: 'Facebook',
    letter: 'f',
    accentColor: '#1877F2',
  },
};

export function SocialLoginButton({
  provider,
  onPress,
  loading = false,
}: SocialLoginButtonProps) {
  const config = providerConfig[provider];

  return (
    <Pressable
      style={styles.button}
      onPress={onPress}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#64748B" />
      ) : (
        <>
          <View style={[styles.letterCircle, { backgroundColor: config.accentColor }]}>
            <Text style={styles.letter}>
              {config.letter}
            </Text>
          </View>
          <Text style={styles.label}>{config.label}</Text>
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
    height: Platform.OS === 'android' ? 48 : 50,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  letterCircle: {
    width: 22,
    height: 22,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontSize: 13,
    color: '#FFFFFF',
    fontFamily: Platform.OS === 'ios' ? 'Inter_700Bold' : 'Quicksand_700Bold',
  },
  label: {
    fontSize: Platform.OS === 'android' ? 13 : 14,
    fontFamily: Platform.OS === 'ios' ? 'Inter_600SemiBold' : 'Quicksand_600SemiBold',
    color: '#0F172A',
  },
});
