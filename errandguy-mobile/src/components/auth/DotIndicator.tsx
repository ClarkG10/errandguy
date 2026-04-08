import React from 'react';
import { View } from 'react-native';

interface DotIndicatorProps {
  total: number;
  active: number;
}

export function DotIndicator({ total, active }: DotIndicatorProps) {
  return (
    <View className="flex-row items-center justify-center gap-2">
      {Array.from({ length: total }).map((_, index) => (
        <View
          key={index}
          className={`rounded-full ${
            index === active
              ? 'w-2.5 h-2.5 bg-primary'
              : 'w-2 h-2 bg-primaryLight'
          }`}
        />
      ))}
    </View>
  );
}
