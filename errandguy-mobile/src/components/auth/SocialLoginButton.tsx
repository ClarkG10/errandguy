import React from 'react';
import { Pressable, Text, ActivityIndicator, View } from 'react-native';

interface SocialLoginButtonProps {
  provider: 'google' | 'facebook';
  onPress: () => void;
  loading?: boolean;
}

const providerConfig = {
  google: {
    label: 'Continue with Google',
    letter: 'G',
    letterColor: '#4285F4',
  },
  facebook: {
    label: 'Continue with Facebook',
    letter: 'f',
    letterColor: '#1877F2',
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
      className="flex-1 flex-row items-center justify-center border border-divider rounded-xl h-12 bg-surface"
      onPress={onPress}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#475569" />
      ) : (
        <>
          <View className="w-6 h-6 items-center justify-center mr-2">
            <Text
              className="text-lg font-montserrat-bold"
              style={{ color: config.letterColor }}
            >
              {config.letter}
            </Text>
          </View>
          <Text className="text-sm font-montserrat text-textPrimary">
            {config.label}
          </Text>
        </>
      )}
    </Pressable>
  );
}
