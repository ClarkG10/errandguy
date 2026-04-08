import React from 'react';
import { View, Text, ActivityIndicator, Modal } from 'react-native';

interface LoadingOverlayProps {
  isVisible: boolean;
  message?: string;
}

export function LoadingOverlay({ isVisible, message }: LoadingOverlayProps) {
  return (
    <Modal visible={isVisible} transparent statusBarTranslucent>
      <View className="flex-1 bg-black/40 items-center justify-center">
        <View className="bg-surface rounded-2xl px-8 py-6 items-center">
          <ActivityIndicator size="large" color="#2563EB" />
          {message && (
            <Text className="text-sm font-montserrat text-textSecondary mt-3">
              {message}
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}
