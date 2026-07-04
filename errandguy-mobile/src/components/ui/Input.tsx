import React, { useState, useRef } from 'react';
import {
  View,
  TextInput,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  type TextInputProps,
} from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useResponsive } from '../../constants/responsive';
import { LightColors } from '../../constants/colors';

interface InputProps extends Omit<TextInputProps, 'onChange'> {
  label?: string;
  error?: string;
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
}

/**
 * Filled-style form input with a static caption label.
 *
 * 2026 "clean & airy" pass: rest state is a soft muted fill with no
 * visible border (the border is transparent but keeps its width so
 * focusing never shifts layout); focus swaps to a white fill with a
 * 1.5px brand-blue border + soft glow. Labels are sentence-case 13px —
 * the old uppercase micro-labels read dated.
 *
 * The label is static (not floating) — a previous floating-label
 * version forced a layout pass per keystroke and felt glitchy.
 */
export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  secureTextEntry,
  keyboardType,
  maxLength,
  multiline,
  numberOfLines,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = secureTextEntry !== undefined;
  const inputRef = useRef<TextInput>(null);
  const { mScale } = useResponsive();

  // Filled → focused transition: muted fill at rest, white + blue
  // border when active. Border width is constant so focus never
  // shifts layout.
  const borderColor = error
    ? LightColors.danger
    : focused
      ? LightColors.primary
      : 'transparent';
  const backgroundColor =
    focused || error ? LightColors.surface : LightColors.surfaceMuted;
  const labelColor = error ? LightColors.danger : LightColors.textSecondary;

  // Generous 2026 sizing — a 52pt field breathes and is comfortably
  // above the 44pt touch-target minimum.
  const minH = mScale(52);
  const minHMulti = mScale(96);
  const padH = mScale(16);
  const labelSize = mScale(13);
  const inputSize = mScale(15);
  const iconSize = mScale(18);

  return (
    <View style={fs.wrapper}>
      {label && (
        <Text style={[fs.label, { color: labelColor, fontSize: labelSize }]}>{label}</Text>
      )}
      <Pressable
        style={[
          fs.container,
          { borderColor, backgroundColor, minHeight: minH, paddingHorizontal: padH },
          focused && !error ? fs.focusedShadow : null,
          multiline && [fs.multiline, { minHeight: minHMulti }],
        ]}
        onPress={() => inputRef.current?.focus()}
      >
        {LeftIcon && (
          <LeftIcon size={iconSize} color={LightColors.textMuted} style={{ marginRight: 10 }} />
        )}
        <TextInput
          ref={inputRef}
          accessibilityLabel={label || placeholder}
          accessibilityState={{ disabled: rest.editable === false }}
          style={[fs.input, { fontSize: inputSize }, multiline && fs.inputMultiline]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={LightColors.dividerStrong}
          secureTextEntry={isPassword && !showPassword}
          keyboardType={keyboardType}
          maxLength={maxLength}
          multiline={multiline}
          numberOfLines={numberOfLines}
          textAlignVertical={multiline ? 'top' : 'center'}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...rest}
        />
        {isPassword && (
          <Pressable
            hitSlop={10}
            onPress={() => setShowPassword(!showPassword)}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            style={{ marginLeft: 8 }}
          >
            {showPassword ? (
              <EyeOff size={iconSize} color={LightColors.textMuted} />
            ) : (
              <Eye size={iconSize} color={LightColors.textMuted} />
            )}
          </Pressable>
        )}
        {RightIcon && !isPassword && (
          <RightIcon size={iconSize} color={LightColors.textMuted} style={{ marginLeft: 8 }} />
        )}
      </Pressable>
      {error && (
        <Text
          style={fs.error}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          {error}
        </Text>
      )}
    </View>
  );
}

const fs = StyleSheet.create({
  wrapper: { marginBottom: 16 },
  label: {
    // Sentence-case medium label — friendlier than the previous
    // uppercase tracked micro-label.
    fontFamily: 'Quicksand_500Medium',
    marginBottom: 8,
    marginLeft: 2,
  },
  container: {
    // Constant 1.5px border (transparent at rest) so the focus border
    // appears without any layout shift.
    borderWidth: 1.5,
    // 16px — matches Button; soft squircle on the generous scale.
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Soft brand-blue focus ring — visually echoes the primary CTA
  // and reinforces the blue-first identity without screaming.
  focusedShadow: Platform.select({
    ios: {
      shadowColor: LightColors.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.18,
      shadowRadius: 8,
    },
    android: { elevation: 1 },
    default: {},
  }) as any,
  multiline: { alignItems: 'flex-start', paddingVertical: 12 },
  input: {
    flex: 1,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textPrimary,
    paddingVertical: 0,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  error: {
    fontSize: 12,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.danger,
    marginTop: 4,
    marginLeft: 4,
  },
});
