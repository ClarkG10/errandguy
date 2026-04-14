import React from 'react';
import { Pressable, Text, View, ActivityIndicator, StyleSheet } from 'react-native';

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
          <View style={[styles.letterCircle, { backgroundColor: config.accentColor + '12' }]}>
            <Text style={[styles.letter, { color: config.accentColor }]}>
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
    height: 52,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  letterCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  label: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: '#0F172A',
  },
});
