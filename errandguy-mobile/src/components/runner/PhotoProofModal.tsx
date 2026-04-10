import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Camera, RotateCcw, Check, X } from 'lucide-react-native';
import { Button } from '../ui/Button';
import { useImagePicker } from '../../hooks/useImagePicker';

interface PhotoProofModalProps {
  type: 'pickup' | 'delivery';
  onConfirm: (uri: string) => void;
  onClose: () => void;
}

export function PhotoProofModal({ type, onConfirm, onClose }: PhotoProofModalProps) {
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const { pickImage, takePhoto } = useImagePicker();

  const handleCapture = async () => {
    const result = await takePhoto();
    if (result) setPhotoUri(result.uri);
  };

  const handleGallery = async () => {
    const result = await pickImage();
    if (result) setPhotoUri(result.uri);
  };

  return (
    <View className="absolute inset-0 bg-black/60 justify-center items-center px-6 z-50">
      <View className="bg-background rounded-3xl p-6 w-full max-w-sm">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-lg font-montserrat-bold text-textPrimary">
            {type === 'pickup' ? 'Pickup Photo' : 'Delivery Photo'}
          </Text>
          <Pressable onPress={onClose}>
            <X size={24} color="#64748B" />
          </Pressable>
        </View>

        <Text className="text-xs font-montserrat text-textSecondary mb-4">
          {type === 'pickup'
            ? 'Take a photo of the item you picked up.'
            : 'Take a photo as proof of delivery.'}
        </Text>

        {!photoUri ? (
          <View className="gap-3">
            <Pressable
              onPress={handleCapture}
              className="h-48 bg-gray-100 rounded-xl items-center justify-center border-2 border-dashed border-divider"
            >
              <Camera size={40} color="#94A3B8" />
              <Text className="text-sm font-montserrat text-textSecondary mt-2">
                Take Photo
              </Text>
            </Pressable>
            <Button
              title="Choose from Gallery"
              variant="outline"
              onPress={handleGallery}
              fullWidth
            />
          </View>
        ) : (
          <View>
            <Image
              source={{ uri: photoUri }}
              className="w-full h-48 rounded-xl mb-4"
              contentFit="cover"
            />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button
                  title="Retake"
                  variant="outline"
                  onPress={() => setPhotoUri(null)}
                  fullWidth
                />
              </View>
              <View className="flex-1">
                <Button
                  title="Confirm"
                  onPress={() => onConfirm(photoUri)}
                  fullWidth
                />
              </View>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
