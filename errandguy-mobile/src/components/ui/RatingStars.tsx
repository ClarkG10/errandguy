import React from 'react';
import { View, Pressable } from 'react-native';
import { Star } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';

interface RatingStarsProps {
  value: number;
  onChange?: (value: number) => void;
  size?: number;
  readonly?: boolean;
}

export function RatingStars({
  value,
  onChange,
  size = 24,
  readonly = false,
}: RatingStarsProps) {
  return (
    <View className="flex-row gap-1">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= Math.floor(value);
        const halfFilled = !filled && star - 0.5 <= value;

        return (
          <Pressable
            key={star}
            onPress={() => !readonly && onChange?.(star)}
            disabled={readonly}
          >
            <Star
              size={size}
              color={LightColors.warning}
              fill={filled ? LightColors.warning : halfFilled ? LightColors.warningSoft : 'transparent'}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
