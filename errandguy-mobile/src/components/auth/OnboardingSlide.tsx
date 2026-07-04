import React from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { Image, type ImageSource } from 'expo-image';

interface OnboardingSlideProps {
  /**
   * Pre-rendered illustration node — preferred. Accepts any of the
   * SVG components from `OnboardingIllustrations` so the carousel
   * can pass an interactive, vector-perfect scene rather than a
   * raster.
   */
  illustration?: React.ReactNode;
  /**
   * Fallback raster source — kept for backward compatibility with
   * any caller still using the old `image` prop.
   */
  image?: ImageSource | number;
  title: string;
  description: string;
}

/**
 * One slide in the welcome carousel.
 *
 * Prefers a vector `illustration` node (zero asset cost, scales
 * perfectly on every device). Falls back to a raster `image` so we
 * don't break any pre-existing call sites.
 */
export function OnboardingSlide({
  illustration,
  image,
  title,
  description,
}: OnboardingSlideProps) {
  const { width } = useWindowDimensions();

  return (
    <View
      className="flex-1 items-center justify-center px-8"
      style={{ width }}
    >
      <View className="flex-[0.6] items-center justify-center w-full">
        {illustration ? (
          illustration
        ) : image ? (
          <Image
            source={image}
            style={{ width: 240, height: 240 }}
            contentFit="contain"
          />
        ) : null}
      </View>
      <View className="flex-[0.4] items-center px-2">
        <Text
          className="font-montserrat-bold text-textPrimary text-center mb-3 tracking-tight"
          style={{ fontSize: 34, lineHeight: 40 }}
        >
          {title}
        </Text>
        <Text className="text-base font-montserrat text-textSecondary text-center leading-6 max-w-[320px]">
          {description}
        </Text>
      </View>
    </View>
  );
}
