import React from 'react';
import { View, Text } from 'react-native';
import Slider from '@react-native-community/slider';
import { formatCurrency } from '../../utils/formatCurrency';

interface OfferSliderProps {
  value: number;
  min: number;
  max: number;
  recommendedMin?: number;
  recommendedMax?: number;
  onChange: (value: number) => void;
}

export function OfferSlider({
  value,
  min,
  max,
  recommendedMin,
  recommendedMax,
  onChange,
}: OfferSliderProps) {
  return (
    <View className="mb-4">
      <Text className="text-sm font-montserrat-bold text-textPrimary mb-2">
        Your Offer
      </Text>

      <View className="items-center mb-3">
        <Text className="text-3xl font-montserrat-bold text-primary">
          {formatCurrency(value)}
        </Text>
      </View>

      <Slider
        value={value}
        minimumValue={min}
        maximumValue={max}
        step={5}
        onValueChange={onChange}
        minimumTrackTintColor="#2563EB"
        maximumTrackTintColor="#E2E8F0"
        thumbTintColor="#2563EB"
      />

      <View className="flex-row justify-between mt-1">
        <Text className="text-xs font-montserrat text-textSecondary">
          {formatCurrency(min)}
        </Text>
        <Text className="text-xs font-montserrat text-textSecondary">
          {formatCurrency(max)}
        </Text>
      </View>

      {recommendedMin != null && recommendedMax != null && (
        <View className="mt-3 p-3 bg-primaryLight rounded-lg">
          <Text className="text-xs font-montserrat text-primary text-center">
            Suggested: {formatCurrency(recommendedMin)} -{' '}
            {formatCurrency(recommendedMax)}
          </Text>
        </View>
      )}
    </View>
  );
}
