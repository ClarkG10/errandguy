import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Tag } from 'lucide-react-native';
import { Card } from '../ui/Card';

interface PromoBannerProps {
  code: string;
  title: string;
  description?: string;
  onPress?: () => void;
}

export function PromoBanner({ code, title, description, onPress }: PromoBannerProps) {
  return (
    <Pressable onPress={onPress}>
      <Card className="bg-primaryLight border-primary">
        <View className="flex-row items-center gap-3">
          <View className="w-10 h-10 rounded-full bg-primary items-center justify-center">
            <Tag size={18} color="#FFFFFF" />
          </View>
          <View className="flex-1">
            <Text className="text-sm font-montserrat-bold text-primary">{title}</Text>
            {description && (
              <Text className="text-xs font-montserrat text-textSecondary mt-0.5">
                {description}
              </Text>
            )}
            <View className="mt-1 self-start bg-primary px-2 py-0.5 rounded">
              <Text className="text-[10px] font-montserrat-bold text-white">{code}</Text>
            </View>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}
