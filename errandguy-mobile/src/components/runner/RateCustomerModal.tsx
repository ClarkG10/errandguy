import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { X } from 'lucide-react-native';
import { Avatar } from '../ui/Avatar';
import { RatingStars } from '../ui/RatingStars';
import { Button } from '../ui/Button';

interface RateCustomerModalProps {
  customerName: string;
  customerAvatar?: string | null;
  onSubmit: (rating: number, comment: string) => void;
  onSkip: () => void;
}

export function RateCustomerModal({
  customerName,
  customerAvatar,
  onSubmit,
  onSkip,
}: RateCustomerModalProps) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  return (
    <View className="absolute inset-0 bg-black/60 justify-center items-center px-6 z-50">
      <View className="bg-background rounded-3xl p-6 w-full max-w-sm">
        <View className="items-center mb-4">
          <Avatar uri={customerAvatar} name={customerName} size="xl" />
          <Text className="text-base font-montserrat-bold text-textPrimary mt-2">
            Rate {customerName}
          </Text>
          <Text className="text-xs font-montserrat text-textSecondary">
            How was your experience?
          </Text>
        </View>

        <View className="items-center mb-4">
          <RatingStars
            value={rating}
            onChange={setRating}
            size={36}
          />
        </View>

        <TextInput
          className="bg-surface border border-divider rounded-xl p-3 text-sm font-montserrat text-textPrimary min-h-[80px] mb-4"
          placeholder="Leave a comment (optional)"
          placeholderTextColor="#94A3B8"
          multiline
          maxLength={200}
          value={comment}
          onChangeText={setComment}
          textAlignVertical="top"
        />

        <View className="gap-2">
          <Button
            title="Submit"
            onPress={() => onSubmit(rating, comment)}
            disabled={rating === 0}
            fullWidth
          />
          <Pressable onPress={onSkip} className="items-center py-2">
            <Text className="text-sm font-montserrat text-textSecondary">
              Skip
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
