import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';

interface SettingsSheetProps {
  visible: boolean;
  /** Ignored while `busy`, so a request in flight can't be abandoned mid-way. */
  onClose: () => void;
  busy?: boolean;
  title: string;
  subtitle?: React.ReactNode;
  /** Screen-reader label for the dimmed backdrop that dismisses the sheet. */
  dismissLabel: string;
  /**
   * A problem to show inside the sheet. Toasts render BENEATH a native Modal,
   * so an error raised while the sheet is open has to be said here or it is
   * never seen.
   */
  notice?: string | null;
  children: React.ReactNode;
}

/**
 * The bottom-sheet chrome shared by the account-security forms (Change
 * password, Verify email): a dimmed backdrop that dismisses, a keyboard-aware
 * card with a grab handle, and a scrollable body — the same construction as
 * DeleteAccountSheet, so every account form in Profile looks and behaves alike.
 */
export function SettingsSheet({
  visible,
  onClose,
  busy = false,
  title,
  subtitle,
  dismissLabel,
  notice,
  children,
}: SettingsSheetProps) {
  const insets = useSafeAreaInsets();
  const close = () => {
    if (!busy) onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={close}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable
          className="flex-1 bg-black/40 justify-end"
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
        >
          <Pressable
            className="bg-surface rounded-t-3xl px-5 pt-6"
            style={{ paddingBottom: insets.bottom + 16, maxHeight: '92%' }}
            accessible={false}
            onPress={() => {}}
          >
            <View className="w-10 h-1 rounded-full bg-divider self-center mb-5" />
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>
              <Text
                className="text-base font-montserrat-bold text-textPrimary mb-1"
                accessibilityRole="header"
              >
                {title}
              </Text>
              {subtitle ? (
                <Text className="text-sm font-montserrat text-textTertiary mb-5">{subtitle}</Text>
              ) : (
                <View className="mb-4" />
              )}
              {notice ? (
                <View
                  className="flex-row items-start rounded-xl px-3 py-2.5 mb-4 bg-dangerSoft"
                  // One focusable unit, read as an alert (icon + sentence).
                  accessible
                  accessibilityLiveRegion="polite"
                  accessibilityRole="alert"
                  accessibilityLabel={notice}
                >
                  <AlertTriangle size={16} color={LightColors.dangerDark} strokeWidth={2} style={{ marginTop: 1 }} />
                  <Text className="flex-1 text-[13px] font-montserrat text-dangerDark ml-2">{notice}</Text>
                </View>
              ) : null}
              {children}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
