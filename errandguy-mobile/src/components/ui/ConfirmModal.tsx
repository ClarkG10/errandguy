import React, { useCallback } from 'react';
import { View, Text, Modal, Pressable, ScrollView } from 'react-native';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import { Button } from './Button';
import { useResponsive } from '../../constants/responsive';
import { LightColors } from '../../constants/colors';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmLoadingLabel?: string;
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
  confirmLoadingLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { width } = useResponsive();
  const dialogMaxWidth = Math.min(width - 48, 380);

  const handleConfirm = useCallback(() => {
    if (destructive) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
    onConfirm();
  }, [destructive, onConfirm]);

  const handleCancel = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    onCancel();
  }, [onCancel]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={loading ? undefined : handleCancel}
    >
      <Pressable
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 24,
          backgroundColor: `${LightColors.ink}73`,
        }}
        onPress={loading ? undefined : handleCancel}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ width: '100%', maxWidth: dialogMaxWidth }}
        >
          <MotiView
            from={{ opacity: 0, scale: 0.92, translateY: 12 }}
            animate={{ opacity: 1, scale: 1, translateY: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 240, mass: 0.7 }}
            style={{
              backgroundColor: LightColors.surface,
              borderRadius: 20,
              paddingHorizontal: 24,
              paddingTop: 26,
              paddingBottom: 22,
            }}
          >
            <Text
              style={{
                fontSize: 17,
                fontFamily: 'Quicksand_700Bold',
                color: LightColors.textPrimary,
                textAlign: 'center',
                marginBottom: 10,
              }}
            >
              {title}
            </Text>

            {/* Scrollable message — long copy never pushes buttons off-screen */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              bounces={false}
              style={{ maxHeight: 180 }}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: 'Quicksand_400Regular',
                  color: LightColors.textSecondary,
                  textAlign: 'center',
                  lineHeight: 21,
                }}
              >
                {message}
              </Text>
            </ScrollView>

            {/* Stacked action buttons — modern pattern replacing the old
                horizontal-split row. Primary action is always visible and
                tappable at the natural thumb position; cancel sits below
                as a quieter ghost tap. */}
            <View style={{ gap: 10 }}>
              <Button
                title={confirmLabel}
                loadingTitle={confirmLoadingLabel}
                variant={destructive ? 'danger' : 'primary'}
                fullWidth
                loading={loading}
                disabled={loading}
                onPress={handleConfirm}
              />
              <Button
                title={cancelLabel}
                variant="ghost"
                fullWidth
                disabled={loading}
                onPress={handleCancel}
              />
            </View>
          </MotiView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
