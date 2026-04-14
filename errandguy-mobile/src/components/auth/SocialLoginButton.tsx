import React from 'react';
import { Pressable, Text, ActivityIndicator } from 'react-native';

interface SocialLoginButtonProps {
  provider: 'google' | 'facebook' | 'apple';
  onPress: () => void;
  loading?: boolean;
}

const providerConfig = {
  google: {
    label: 'Google',
    letter: 'G',
    letterColor: '#4285F4',
    borderColor: '#E2E8F0',
    bg: '#FFFFFF',
  },
  facebook: {
    label: 'Facebook',
    letter: 'f',
    letterColor: '#FFFFFF',
    borderColor: '#1877F2',
    bg: '#1877F2',
  },
  apple: {
    label: 'Apple',
    letter: '\uF8FF',
    letterColor: '#FFFFFF',
    borderColor: '#000000',
    bg: '#000000',
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
      className="w-14 h-14 rounded-2xl items-center justify-center border"
      style={{
        backgroundColor: config.bg,
        borderColor: config.borderColor,
      }}
      onPress={onPress}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color={config.letterColor} />
      ) : (
        <Text
          className="text-xl font-montserrat-bold"
          style={{ color: config.letterColor }}
        >
          {provider === 'apple' ? '🍎' : config.letter}
        </Text>
      )}
    </Pressable>
  );
}
