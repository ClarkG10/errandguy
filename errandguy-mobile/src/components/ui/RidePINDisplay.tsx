import React from 'react';
import { View, Text } from 'react-native';

interface RidePINDisplayProps {
  pin: string;
}

export function RidePINDisplay({ pin }: RidePINDisplayProps) {
  const digits = pin.split('');

  return (
    <View className="flex-row justify-center gap-3">
      {digits.map((digit, index) => (
        <View
          key={index}
          className="w-14 h-16 border-2 border-primary rounded-xl items-center justify-center bg-primaryLight/30"
        >
          <Text className="text-2xl font-montserrat-bold text-primary">
            {digit}
          </Text>
        </View>
      ))}
    </View>
  );
}
