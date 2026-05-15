import React from 'react';
import { View, Text, Modal, Pressable, ScrollView } from 'react-native';
import { MotiView } from 'moti';
import { ErrandLoader } from './ErrandLoader';
import { useResponsive } from '../../constants/responsive';

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
  // NativeWind's `max-w-sm` doesn't apply on native, so we cap the
  // dialog width imperatively. 420pt is the comfortable upper bound
  // for a confirm dialog \u2014 wider feels like a sheet, not a prompt.
  const { width } = useResponsive();
  const dialogMaxWidth = Math.min(width - 48, 420);
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
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ width: '100%', maxWidth: dialogMaxWidth }}
        >
          <MotiView
            from={{ opacity: 0, scale: 0.92, translateY: 12 }}
            animate={{ opacity: 1, scale: 1, translateY: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 240, mass: 0.7 }}
            className="bg-white overflow-hidden"
            style={{ maxHeight: '80%' }}
          >
            {/* Long copy is allowed to scroll inside the dialog — a
                long Terms-of-service or cancellation reason will no
                longer push the action row off-screen. */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 28, paddingBottom: 22 }}
            >
              <Text className="text-[16px] font-montserrat-bold text-textPrimary text-center">
                {title}
              </Text>
              <Text className="text-[13px] font-montserrat text-textSecondary text-center mt-3" style={{ lineHeight: 20 }}>
                {message}
              </Text>
            </ScrollView>
            <View className="flex-row border-t border-divider">
              <Pressable
                className="flex-1 py-4 items-center border-r border-divider active:bg-gray-50"
                onPress={onCancel}
                disabled={loading}
              >
                <Text className="text-[13px] font-montserrat-semi text-textSecondary">
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
                    className={`text-[13px] font-montserrat-bold ${
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
