import React, { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import {
  View,
  TextInput,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  type TextInputProps,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Eye, EyeOff } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useResponsive } from '../../constants/responsive';
import { LightColors } from '../../constants/colors';

interface InputProps extends Omit<TextInputProps, 'onChange'> {
  label?: string;
  error?: string;
  /** Persistent caption under the field for guidance that must survive
   *  typing (placeholders vanish on the first keystroke). Hidden while
   *  an error is showing — the two share the same slot. */
  helperText?: string;
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
  /** Tint for the non-password right icon (defaults to textMuted). Lets
   *  screens show a success-tinted confirmation glyph (e.g. a pinned
   *  address) without a bespoke input variant. */
  rightIconColor?: string;
  /** Makes the non-password right icon tappable (e.g. clear, open map).
   *  When absent the icon stays purely decorative — no behavior change. */
  onRightIconPress?: () => void;
  /** Screen-reader label for the tappable right icon. */
  rightIconAccessibilityLabel?: string;
}

/** Imperative surface exposed via ref — lets screens chain focus from a
 *  keyboard "next" key (returnKeyType/onSubmitEditing) without reaching
 *  into the private TextInput. */
export interface InputHandle {
  focus: () => void;
  blur: () => void;
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
export const Input = forwardRef<InputHandle, InputProps>(function Input(
  {
    label,
    value,
    onChangeText,
    placeholder,
    error,
    helperText,
    leftIcon: LeftIcon,
    rightIcon: RightIcon,
    rightIconColor,
    onRightIconPress,
    rightIconAccessibilityLabel,
    secureTextEntry,
    keyboardType,
    maxLength,
    multiline,
    numberOfLines,
    onFocus,
    onBlur,
    ...rest
  }: InputProps,
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = secureTextEntry !== undefined;
  const inputRef = useRef<TextInput>(null);
  const { mScale } = useResponsive();

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    blur: () => inputRef.current?.blur(),
  }));

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
          // textMuted (not dividerStrong): the old #CBD5E1 hint measured
          // ~1.6:1 on the muted fill — invisible in sunlight. #94A3B8 keeps
          // hint-weight while roughly doubling contrast (WCAG placeholder
          // guidance).
          placeholderTextColor={LightColors.textMuted}
          secureTextEntry={isPassword && !showPassword}
          keyboardType={keyboardType}
          maxLength={maxLength}
          multiline={multiline}
          numberOfLines={numberOfLines}
          textAlignVertical={multiline ? 'top' : 'center'}
          // Merge caller callbacks so form libraries (react-hook-form's
          // onTouched mode) still see blur events without clobbering the
          // internal focus styling.
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {isPassword && (
          <Pressable
            // Icon is ~18pt — 14pt of slop on every edge lifts the
            // effective target to ≥44pt.
            hitSlop={14}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setShowPassword(!showPassword);
            }}
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
          onRightIconPress ? (
            <Pressable
              // Same slop math as the password eye — lifts the ~18pt
              // icon to a ≥44pt effective target.
              hitSlop={14}
              onPress={onRightIconPress}
              accessibilityRole="button"
              accessibilityLabel={rightIconAccessibilityLabel}
              style={{ marginLeft: 8 }}
            >
              <RightIcon
                size={iconSize}
                color={rightIconColor ?? LightColors.textMuted}
              />
            </Pressable>
          ) : (
            <RightIcon
              size={iconSize}
              color={rightIconColor ?? LightColors.textMuted}
              style={{ marginLeft: 8 }}
            />
          )
        )}
      </Pressable>
      {error ? (
        <Text
          style={fs.error}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          {error}
        </Text>
      ) : helperText ? (
        <Text style={fs.helper}>{helperText}</Text>
      ) : null}
    </View>
  );
});

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
    // 12px control corner ("Modern soft") — subtler than the old 16.
    borderRadius: 12,
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
  helper: {
    fontSize: 12,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textTertiary,
    marginTop: 4,
    marginLeft: 4,
  },
  error: {
    fontSize: 12,
    fontFamily: 'Quicksand_400Regular',
    // dangerDark, not danger: #EF4444 measures ~3.8:1 on white — under the
    // 4.5:1 AA floor for 12px text. Convention: danger for fills/borders,
    // dangerDark for any danger TEXT below 17px.
    color: LightColors.dangerDark,
    marginTop: 4,
    marginLeft: 4,
  },
});
