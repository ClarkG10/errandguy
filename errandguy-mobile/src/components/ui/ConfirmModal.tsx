import React from 'react';
import { View, Text, Modal, Pressable } from 'react-native';
import { MotiView } from 'moti';
import { ErrandLoader } from './ErrandLoader';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={loading ? undefined : onCancel}
    >
      <Pressable
        className="flex-1 bg-black/50 justify-center items-center px-6"
        onPress={loading ? undefined : onCancel}
      >
        <Pressable onPress={(e) => e.stopPropagation()} className="w-full max-w-sm">
          <MotiView
            from={{ opacity: 0, scale: 0.85, translateY: 20 }}
            animate={{ opacity: 1, scale: 1, translateY: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 220, mass: 0.8 }}
            className="bg-white rounded-2xl overflow-hidden"
          >
            <View className="px-6 pt-6 pb-5">
              <Text className="text-lg font-montserrat-bold text-textPrimary text-center">
                {title}
              </Text>
              <Text className="text-sm font-montserrat text-textSecondary text-center mt-2">
                {message}
              </Text>
            </View>
            <View className="flex-row border-t border-divider">
              <Pressable
                className="flex-1 py-4 items-center border-r border-divider active:bg-gray-50"
                onPress={onCancel}
                disabled={loading}
              >
                <Text className="text-sm font-montserrat-semi text-textSecondary">
                  {cancelLabel}
                </Text>
              </Pressable>
              <Pressable
                className="flex-1 py-4 items-center active:bg-gray-50"
                onPress={onConfirm}
                disabled={loading}
              >
                {loading ? (
                  <ErrandLoader
                    size={5}
                    color={destructive ? '#EF4444' : '#2563EB'}
                  />
                ) : (
                  <Text
                    className={`text-sm font-montserrat-bold ${
                      destructive ? 'text-danger' : 'text-primary'
                    }`}
                  >
                    {confirmLabel}
                  </Text>
                )}
              </Pressable>
            </View>
          </MotiView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
