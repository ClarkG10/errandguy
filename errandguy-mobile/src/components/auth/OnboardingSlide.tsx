import React from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';

interface OnboardingSlideProps {
  image: any;
  title: string;
  description: string;
}

export function OnboardingSlide({ image, title, description }: OnboardingSlideProps) {
  const { width } = useWindowDimensions();

  return (
    <View className="flex-1 items-center justify-center px-8" style={{ width }}>
      <View className="flex-[0.6] items-center justify-center w-full">
        <Image
          source={image}
          className="w-64 h-64"
          contentFit="contain"
        />
      </View>
      <View className="flex-[0.4] items-center">
        <Text className="text-2xl font-montserrat-bold text-textPrimary text-center mb-3">
          {title}
        </Text>
        <Text className="text-base font-montserrat text-textSecondary text-center leading-6">
          {description}
        </Text>
      </View>
    </View>
  );
}
