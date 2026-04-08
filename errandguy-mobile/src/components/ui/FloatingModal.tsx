import React from 'react';
import { View, Pressable, Text, Modal } from 'react-native';
import { MotiView } from 'moti';
import { X } from 'lucide-react-native';

interface FloatingModalProps {
  isVisible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
}

export function FloatingModal({
  isVisible,
  onClose,
  children,
  title,
}: FloatingModalProps) {
  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 bg-black/40 justify-center items-center px-5"
        onPress={onClose}
      >
        <Pressable onPress={(e) => e.stopPropagation()}>
          <MotiView
            from={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', damping: 15, stiffness: 150 }}
            className="bg-surface rounded-[24px] p-6 w-full min-w-[300px]"
          >
            {title && (
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-lg font-montserrat-bold text-textPrimary">
                  {title}
                </Text>
                <Pressable onPress={onClose} className="p-1">
                  <X size={20} color="#475569" />
                </Pressable>
              </View>
            )}
            {children}
          </MotiView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
