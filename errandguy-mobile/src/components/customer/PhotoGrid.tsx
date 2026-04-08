import React from 'react';
import { View, Pressable, Text } from 'react-native';
import { Image } from 'expo-image';
import { X, Plus, Camera } from 'lucide-react-native';

interface PhotoGridProps {
  photos: string[];
  maxPhotos?: number;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

export function PhotoGrid({
  photos,
  maxPhotos = 5,
  onAdd,
  onRemove,
}: PhotoGridProps) {
  const canAdd = photos.length < maxPhotos;

  return (
    <View className="mb-4">
      <Text className="text-sm font-montserrat-bold text-textPrimary mb-2">
        Item Photos ({photos.length}/{maxPhotos})
      </Text>
      <View className="flex-row flex-wrap gap-3">
        {photos.map((uri, index) => (
          <View
            key={index}
            className="w-20 h-20 rounded-lg overflow-hidden bg-divider"
          >
            <Image
              source={{ uri }}
              className="w-full h-full"
              resizeMode="cover"
            />
            <Pressable
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-danger items-center justify-center"
              onPress={() => onRemove(index)}
            >
              <X size={12} color="#FFFFFF" />
            </Pressable>
          </View>
        ))}
        {canAdd && (
          <Pressable
            className="w-20 h-20 rounded-lg border-2 border-dashed border-divider items-center justify-center bg-surface"
            onPress={onAdd}
          >
            <Camera size={24} color="#94A3B8" />
            <Text className="text-[10px] font-montserrat text-textSecondary mt-1">
              Add
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
