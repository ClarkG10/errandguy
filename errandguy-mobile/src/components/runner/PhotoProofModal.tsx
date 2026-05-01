import React, { useState } from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { Image } from 'expo-image';
import { MotiView } from 'moti';
import { Camera, X } from 'lucide-react-native';
import { Button } from '../ui/Button';
import { useImagePicker } from '../../hooks/useImagePicker';

interface PhotoProofModalProps {
  type: 'pickup' | 'delivery';
  onConfirm: (uri: string) => void;
  onClose: () => void;
}

export function PhotoProofModal({ type, onConfirm, onClose }: PhotoProofModalProps) {
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { pickImage, takePhoto } = useImagePicker();

  const handleCapture = async () => {
    const result = await takePhoto();
    if (result) setPhotoUri(result.uri);
  };

  const handleGallery = async () => {
    const result = await pickImage();
    if (result) setPhotoUri(result.uri);
  };

  const handleConfirm = async () => {
    if (!photoUri || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(photoUri);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={submitting ? undefined : onClose}
    >
      <Pressable
        className="flex-1 bg-black/60 justify-end"
        onPress={submitting ? undefined : onClose}
      >
        <Pressable onPress={(e) => e.stopPropagation()}>
          <MotiView
            from={{ translateY: 400, opacity: 0 }}
            animate={{ translateY: 0, opacity: 1 }}
            transition={{ type: 'spring', damping: 22, stiffness: 220, mass: 0.8 }}
            className="bg-background rounded-t-2xl p-6 pb-10"
          >
            {/* Handle */}
            <View className="items-center pb-3">
              <View className="w-10 h-1.5 rounded-full bg-divider" />
            </View>

            {/* Header */}
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-lg font-montserrat-bold text-textPrimary">
                {type === 'pickup' ? 'Pickup Photo' : 'Delivery Photo'}
              </Text>
              <Pressable onPress={onClose} disabled={submitting}>
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
                      disabled={submitting}
                      fullWidth
                    />
                  </View>
                  <View className="flex-1">
                    <Button
                      title="Confirm"
                      onPress={handleConfirm}
                      loading={submitting}
                      fullWidth
                    />
                  </View>
                </View>
              </View>
            )}
          </MotiView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
