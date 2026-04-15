import React from 'react';
import { View, Text, Modal, Pressable } from 'react-native';
import { Button } from './Button';

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
      onRequestClose={onCancel}
    >
      <Pressable
        className="flex-1 bg-black/50 justify-center items-center px-6"
        onPress={onCancel}
      >
        <Pressable
          className="bg-white rounded-2xl w-full max-w-sm overflow-hidden"
          onPress={() => {}}
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
              className="flex-1 py-4 items-center border-r border-divider"
              onPress={onCancel}
              disabled={loading}
            >
              <Text className="text-sm font-montserrat-semi text-textSecondary">
                {cancelLabel}
              </Text>
            </Pressable>
            <Pressable
              className="flex-1 py-4 items-center"
              onPress={onConfirm}
              disabled={loading}
            >
              {loading ? (
                <View className="flex-row items-center gap-1">
                  <Text
                    className={`text-sm font-montserrat-semi ${
                      destructive ? 'text-danger' : 'text-primary'
                    }`}
                  >
                    {confirmLabel}...
                  </Text>
                </View>
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}
