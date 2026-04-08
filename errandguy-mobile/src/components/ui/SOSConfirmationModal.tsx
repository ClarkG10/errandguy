import React from 'react';
import { View, Text } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { FloatingModal } from './FloatingModal';
import { Button } from './Button';

interface SOSConfirmationModalProps {
  isVisible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  bookingId?: string;
}

export function SOSConfirmationModal({
  isVisible,
  onConfirm,
  onCancel,
}: SOSConfirmationModalProps) {
  return (
    <FloatingModal isVisible={isVisible} onClose={onCancel} title="Emergency SOS">
      <View className="items-center mb-4">
        <View className="w-16 h-16 rounded-full bg-danger/10 items-center justify-center mb-3">
          <AlertTriangle size={32} color="#EF4444" />
        </View>
        <Text className="text-sm font-montserrat text-textSecondary text-center">
          Are you sure you want to trigger an SOS alert? This will:
        </Text>
      </View>

      <View className="mb-6 gap-2">
        <Text className="text-sm font-montserrat text-textPrimary">
          • Notify your trusted contacts
        </Text>
        <Text className="text-sm font-montserrat text-textPrimary">
          • Share your live location
        </Text>
        <Text className="text-sm font-montserrat text-textPrimary">
          • Alert the ErrandGuy support team
        </Text>
      </View>

      <View className="gap-3">
        <Button
          title="Confirm SOS"
          variant="danger"
          onPress={onConfirm}
          fullWidth
        />
        <Button
          title="Cancel"
          variant="ghost"
          onPress={onCancel}
          fullWidth
        />
      </View>
    </FloatingModal>
  );
}
