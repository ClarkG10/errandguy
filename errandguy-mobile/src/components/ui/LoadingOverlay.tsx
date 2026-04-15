import React from 'react';
import { View, Text, Modal } from 'react-native';
import { MotiView } from 'moti';
import { ErrandLoader } from './ErrandLoader';

interface LoadingOverlayProps {
  isVisible: boolean;
  message?: string;
}

export function LoadingOverlay({ isVisible, message }: LoadingOverlayProps) {
  return (
    <Modal visible={isVisible} transparent statusBarTranslucent animationType="fade">
      <View className="flex-1 bg-black/40 items-center justify-center">
        <MotiView
          from={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          className="bg-surface rounded-2xl px-10 py-8 items-center"
        >
          <ErrandLoader size={12} color="#2563EB" />
          {message && (
            <Text className="text-sm font-montserrat text-textSecondary mt-4">
              {message}
            </Text>
          )}
        </MotiView>
      </View>
    </Modal>
  );
}
