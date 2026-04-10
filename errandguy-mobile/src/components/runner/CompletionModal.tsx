import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { X, Eraser } from 'lucide-react-native';
import { Button } from '../ui/Button';

interface CompletionModalProps {
  bookingId: string;
  deliveryPhotoUrl?: string | null;
  onComplete: (signatureUri: string) => void;
  onClose: () => void;
}

export function CompletionModal({
  bookingId,
  deliveryPhotoUrl,
  onComplete,
  onClose,
}: CompletionModalProps) {
  const [signed, setSigned] = useState(false);

  // Signature pad placeholder — would use react-native-canvas or gesture handler
  const handleSign = () => {
    setSigned(true);
  };

  const handleClear = () => {
    setSigned(false);
  };

  const handleSubmit = () => {
    // In production, capture signature bitmap from canvas
    // For now, use a placeholder URI
    onComplete('signature_placeholder');
  };

  return (
    <View className="absolute inset-0 bg-black/60 justify-end z-50">
      <View className="bg-background rounded-t-3xl px-6 pt-6 pb-10" style={{ maxHeight: '85%' }}>
        {/* Header */}
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-lg font-montserrat-bold text-textPrimary">
            Complete Errand
          </Text>
          <Pressable onPress={onClose}>
            <X size={24} color="#64748B" />
          </Pressable>
        </View>

        {/* Delivery Photo Preview */}
        {deliveryPhotoUrl && (
          <View className="mb-4">
            <Text className="text-xs font-montserrat-bold text-textSecondary mb-2">
              Delivery Photo
            </Text>
            <Image
              source={{ uri: deliveryPhotoUrl }}
              className="w-full h-32 rounded-xl"
              contentFit="cover"
            />
          </View>
        )}

        {/* Signature Pad */}
        <Text className="text-xs font-montserrat-bold text-textSecondary mb-2">
          Customer Signature
        </Text>
        <Pressable
          onPress={handleSign}
          className={`h-40 rounded-xl border-2 border-dashed items-center justify-center mb-3 ${
            signed ? 'border-primary bg-primaryLight' : 'border-divider bg-gray-50'
          }`}
        >
          {signed ? (
            <Text className="text-sm font-montserrat text-primary">
              ✓ Signature captured
            </Text>
          ) : (
            <Text className="text-sm font-montserrat text-textSecondary">
              Tap here for customer to sign
            </Text>
          )}
        </Pressable>

        {signed && (
          <Pressable
            onPress={handleClear}
            className="flex-row items-center justify-center gap-2 mb-4"
          >
            <Eraser size={14} color="#64748B" />
            <Text className="text-xs font-montserrat text-textSecondary">
              Clear Signature
            </Text>
          </Pressable>
        )}

        <Button
          title="Confirm & Complete"
          onPress={handleSubmit}
          disabled={!signed}
          fullWidth
        />
      </View>
    </View>
  );
}
