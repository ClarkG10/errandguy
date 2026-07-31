import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type TextInputProps,
} from 'react-native';
import { LightColors, Elevation } from '../../constants/colors';

/**
 * KeyboardDockInput — a field whose editor DOCKS right above the keyboard.
 *
 * The Messenger / iMessage pattern: the in-form control is a compact display
 * that, when tapped, opens a single editable input pinned just above the
 * keyboard — so what you type is always visible and comfortable to reach,
 * never hidden behind the keyboard.
 *
 * Why a tap-to-edit sheet (not a live mirror of a second TextInput): exactly
 * ONE editable surface is focused at a time, which sidesteps the dual-focus /
 * shared-keyboard glitches that plague "mirror" implementations. Pure JS +
 * built-in RN primitives (Modal + KeyboardAvoidingView) → no native rebuild.
 */
export interface KeyboardDockInputProps
  extends Pick<
    TextInputProps,
    | 'placeholder'
    | 'keyboardType'
    | 'autoCapitalize'
    | 'autoComplete'
    | 'textContentType'
    | 'secureTextEntry'
    | 'maxLength'
    | 'multiline'
    | 'returnKeyType'
  > {
  value: string;
  onChangeText: (text: string) => void;
  /** Uppercase eyebrow shown above the field and inside the dock. */
  label?: string;
  /** Called when the user taps Done / submits from the dock. */
  onSubmit?: () => void;
}

export function KeyboardDockInput({
  value,
  onChangeText,
  label,
  placeholder,
  onSubmit,
  secureTextEntry,
  multiline,
  ...textInputProps
}: KeyboardDockInputProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const open = useCallback(() => setEditing(true), []);
  const close = useCallback(() => {
    inputRef.current?.blur();
    setEditing(false);
  }, []);
  const submit = useCallback(() => {
    onSubmit?.();
    close();
  }, [onSubmit, close]);

  // Mask secure values in the compact display; show a friendly placeholder
  // when empty so the control reads as tappable.
  const display = value
    ? secureTextEntry
      ? '•'.repeat(Math.min(value.length, 12))
      : value
    : placeholder ?? 'Tap to type…';

  return (
    <View>
      {label ? (
        <Text
          className="text-[11px] font-montserrat-bold uppercase text-textSecondary mb-1.5"
          style={{ letterSpacing: 1 }}
        >
          {label}
        </Text>
      ) : null}

      {/* In-form control — compact, shows the current value, opens the dock. */}
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? placeholder ?? 'Edit field'}${
          value ? `, ${secureTextEntry ? 'filled' : value}` : ', empty'
        }`}
        className="bg-white border border-divider rounded-2xl px-4"
        style={[{ minHeight: 52, justifyContent: 'center' }, Elevation.sm]}
      >
        <Text
          numberOfLines={1}
          className={`text-[15px] ${value ? 'text-textPrimary' : 'text-textMuted'}`}
        >
          {display}
        </Text>
      </Pressable>

      {/* Docked editor — pinned above the keyboard. */}
      <Modal
        visible={editing}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={close}
        // Focusing inside a freshly-shown modal is unreliable via autoFocus on
        // iOS — focus once the window is actually presented instead.
        onShow={() => requestAnimationFrame(() => inputRef.current?.focus())}
      >
        <View style={styles.fill}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityLabel="Dismiss editor"
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.bottom}
          >
            <View className="bg-white px-3 pt-2.5" style={styles.dock}>
              {label ? (
                <Text
                  className="text-[11px] font-montserrat-bold uppercase text-textSecondary mb-2 px-1"
                  style={{ letterSpacing: 1 }}
                >
                  {label}
                </Text>
              ) : null}
              <View className="flex-row items-end" style={{ gap: 8 }}>
                <TextInput
                  ref={inputRef}
                  value={value}
                  onChangeText={onChangeText}
                  placeholder={placeholder}
                  placeholderTextColor={LightColors.textMuted}
                  secureTextEntry={secureTextEntry}
                  multiline={multiline}
                  onSubmitEditing={submit}
                  blurOnSubmit={!multiline}
                  className="flex-1 bg-surfaceMuted rounded-2xl px-4 text-[16px] text-textPrimary"
                  style={{ paddingVertical: 12, maxHeight: 140 }}
                  {...textInputProps}
                />
                <Pressable
                  onPress={submit}
                  accessibilityRole="button"
                  accessibilityLabel="Done"
                  className="rounded-2xl px-5"
                  style={[
                    { backgroundColor: LightColors.primary, minHeight: 46, justifyContent: 'center' },
                    Elevation.primary,
                  ]}
                >
                  <Text className="text-white font-montserrat-bold text-[14px]">Done</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  bottom: { width: '100%' },
  dock: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: LightColors.divider,
    ...Elevation.lg,
  },
});
