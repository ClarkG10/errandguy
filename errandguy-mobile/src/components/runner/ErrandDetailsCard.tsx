import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, Linking } from 'react-native';
import { Image } from 'expo-image';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { Card } from '../ui/Card';
import { resolveImageUrl } from '../../utils/resolveImageUrl';
import { LightColors } from '../../constants/colors';

interface ErrandDetailsCardProps {
  description?: string | null;
  specialInstructions?: string | null;
  itemPhotos?: string[] | null;
  estimatedItemValue?: number | null;
}

export function ErrandDetailsCard({
  description,
  specialInstructions,
  itemPhotos,
  estimatedItemValue,
}: ErrandDetailsCardProps) {
  const [expanded, setExpanded] = useState(false);

  const hasContent = description || specialInstructions || (itemPhotos && itemPhotos.length > 0);

  if (!hasContent) return null;

  return (
    <Card className="p-4 mb-3">
      <Pressable
        onPress={() => setExpanded(!expanded)}
        className="flex-row items-center justify-between"
      >
        <Text className="text-sm font-montserrat-bold text-textPrimary">
          Errand Details
        </Text>
        {expanded ? (
          <ChevronUp size={18} color={LightColors.textTertiary} />
        ) : (
          <ChevronDown size={18} color={LightColors.textTertiary} />
        )}
      </Pressable>

      {expanded && (
        <View className="mt-3">
          {description && (
            <View className="mb-2">
              <Text className="text-xs font-montserrat-bold text-textSecondary mb-1">
                Description
              </Text>
              <Text className="text-sm font-montserrat text-textPrimary">
                {description}
              </Text>
            </View>
          )}

          {specialInstructions && (
            <View className="mb-2">
              <Text className="text-xs font-montserrat-bold text-textSecondary mb-1">
                Special Instructions
              </Text>
              <Text className="text-sm font-montserrat text-textPrimary">
                {specialInstructions}
              </Text>
            </View>
          )}

          {estimatedItemValue != null && estimatedItemValue > 0 && (
            <View className="mb-2">
              <Text className="text-xs font-montserrat-bold text-textSecondary mb-1">
                Estimated Item Value
              </Text>
              <Text className="text-sm font-montserrat text-textPrimary">
                ₱{estimatedItemValue.toFixed(2)}
              </Text>
            </View>
          )}

          {itemPhotos && itemPhotos.length > 0 && (
            <View>
              <Text className="text-xs font-montserrat-bold text-textSecondary mb-2">
                Item Photos
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {itemPhotos.map((photo, i) => {
                  const uri = resolveImageUrl(photo);
                  if (!uri) return null;
                  return (
                    <Pressable
                      key={i}
                      onPress={() => Linking.openURL(uri).catch(() => {})}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={`Open item photo ${i + 1}`}
                      style={{ marginRight: 8 }}
                    >
                      <Image
                        source={{ uri }}
                        style={{ width: 96, height: 96, borderRadius: 16, backgroundColor: LightColors.surfaceMuted }}
                        contentFit="cover"
                        transition={150}
                        cachePolicy="memory-disk"
                      />
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </View>
      )}
    </Card>
  );
}
