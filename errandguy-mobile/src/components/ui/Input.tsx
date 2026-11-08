import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import {
  View,
  TextInput,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  InputAccessoryView,
  type TextInputProps,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Eye, EyeOff, Check, AlertCircle } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useResponsive } from '../../constants/responsive';
import { LightColors } from '../../constants/colors';
import { CHROME_MAX_FONT_SCALE } from '../../constants/fontScale';
import { announceFieldError } from '../../utils/validation/announceFieldError';

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
  /** Show a "Done" bar above the keyboard (iOS InputAccessoryView). Defaults on
   *  for multiline and numeric/phone keyboards — which have no return key, so the
   *  keyboard otherwise traps the user over the field. Pass false to force off. */
  keyboardToolbar?: boolean;
  /** The value passed this field's check — shows a quiet success tick at the
   *  right edge. Ignored while `error` is set. Only pass it where a check
   *  actually ran (format, match), never just because the field is filled. */
  valid?: boolean;
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
    keyboardToolbar,
    valid,
    ...rest
  }: InputProps,
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = secureTextEntry !== undefined;
  const inputRef = useRef<TextInput>(null);
  const { mScale } = useResponsive();

  // iOS numeric/phone keyboards (and multiline) have no return key to dismiss,
  // so the keyboard can trap the user over the field. A "Done" accessory bar
  // above the keyboard fixes that. Auto-on for those cases; callers override via
  // the keyboardToolbar prop. InputAccessoryView is iOS-only.
  const numericKeyboard =
    keyboardType != null &&
    ['numeric', 'number-pad', 'decimal-pad', 'phone-pad'].includes(keyboardType);
  const showToolbar =
    Platform.OS === 'ios' && (keyboardToolbar ?? (!!multiline || numericKeyboard));
  const accessoryId = `eg-kbd${React.useId().replace(/:/g, '')}`;

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    blur: () => inputRef.current?.blur(),
  }));

  // `accessibilityLiveRegion` on the error text below is ANDROID-ONLY, and
  // `accessibilityRole="alert"` maps to no iOS trait — so on iOS a rejected
  // field was completely silent. `announceFieldError` covers iOS (and no-ops
  // on Android, so the live region isn't doubled up); it also batches a
  // whole submit's worth of field errors into one sentence, since iOS
  // announcements interrupt each other.
  //
  // Fires only on the transition into an error (or onto a DIFFERENT message):
  // re-rendering with the same error — every keystroke of a field that is
  // still invalid — must not re-interrupt the screen reader.
  const prevErrorRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const previous = prevErrorRef.current;
    prevErrorRef.current = error;
    if (!error || error === previous) return;
    announceFieldError(label ? `${label}, error: ${error}` : error);
  }, [error, label]);

  // RN's `accessibilityState` has no `invalid` key and there is no
  // aria-describedby equivalent, so the LABEL is the only association
  // mechanism: fold the error into it, and the helper caption into the hint.
  // Without this a user who re-focuses the field to find out what went wrong
  // hears "Email" and nothing else — the error text is a separate, unlinked
  // node further down the tree.
  const fieldName = label || placeholder;
  const accessibilityLabel = error
    ? fieldName
      ? `${fieldName}, error: ${error}`
      : `Error: ${error}`
    : fieldName;

  // Filled → focused transition: muted fill at rest, white + blue
  // border when active. Border width is constant so focus never
  // shifts layout.
  // A passed check shows only once the field is filled — an empty field
  // can't be "valid" in a way worth a green border.
  const showValid = !!valid && !error && value != null && String(value).length > 0;
  const borderColor = error
    ? LightColors.danger
    : focused
      ? LightColors.primary
      : showValid
        ? VALID_BORDER
        : 'transparent';
  const backgroundColor =
    focused || error || showValid ? LightColors.surface : LightColors.surfaceMuted;
  // The label stays neutral: the red border, icon and message already say
  // which field is wrong, and a red label too reads as shouting.
  const labelColor = LightColors.textSecondary;

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
        // NOTE: the caption stays in the accessibility tree even though the
        // field's own accessibilityLabel repeats it. Hiding it would be
        // tidier to swipe through, but it is the only fallback if a caller
        // overrides accessibilityLabel via `...rest` — and it is what
        // `getByText(label)` in screen tests relies on.
        <Text
          style={[fs.label, { color: labelColor, fontSize: labelSize }]}
          maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
        >
          {label}
        </Text>
      )}
      <Pressable
        style={[
          fs.container,
          { borderColor, backgroundColor, minHeight: minH, paddingHorizontal: padH },
          focused && !error ? fs.focusedShadow : null,
          error ? fs.errorGlow : null,
          multiline && [fs.multiline, { minHeight: minHMulti }],
        ]}
        onPress={() => inputRef.current?.focus()}
      >
        {LeftIcon && (
          <LeftIcon size={iconSize} color={LightColors.textMuted} style={{ marginRight: 10 }} />
        )}
        <TextInput
          ref={inputRef}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={helperText}
          accessibilityState={{ disabled: rest.editable === false }}
          // NOTE: no maxFontSizeMultiplier on the field text itself — it is
          // free to scale with the OS setting because the container is
          // `minHeight`, so the row grows instead of clipping. Only the
          // small captions around it (label / error / helper) are capped.
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
          inputAccessoryViewID={showToolbar ? accessoryId : undefined}
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
        {error ? (
          <View style={{ marginLeft: 8 }} testID="input-error-icon">
            <AlertCircle size={iconSize} color={LightColors.danger} strokeWidth={2} />
          </View>
        ) : showValid ? (
          <View
            style={fs.validTick}
            accessible
            accessibilityLabel={fieldName ? `${fieldName} looks good` : 'Looks good'}
            testID="input-valid-tick"
          >
            <Check size={iconSize} color={LightColors.success} strokeWidth={2.6} />
          </View>
        ) : null}
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
        <View style={fs.errorRow}>
          {/* Icon as well as colour, so the error doesn't rely on red alone. */}
          <AlertCircle size={13} color={LightColors.dangerDark} strokeWidth={2.2} style={fs.errorIcon} />
          <Text
            style={fs.error}
            // Android announces this on its own. iOS gets the explicit
            // announceForAccessibility above — RN maps neither the live region
            // nor role="alert" to a VoiceOver trait.
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
          >
            {error}
          </Text>
        </View>
      ) : helperText ? (
        <Text style={fs.helper} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
          {helperText}
        </Text>
      ) : null}
      {showToolbar && (
        <InputAccessoryView nativeID={accessoryId}>
          <View style={fs.kbdBar}>
            <Pressable
              onPress={() => inputRef.current?.blur()}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Done editing"
            >
              <Text style={fs.kbdDone} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                Done
              </Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      )}
    </View>
  );
});

// Subtle green for a field whose check passed: success at ~60% so it reads
// as "fine" without competing with the focus blue or an error red.
const VALID_BORDER = `${LightColors.success}99`;

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
    // textSecondary: guidance people must read (rule 15).
    color: LightColors.textSecondary,
    marginTop: 4,
    marginLeft: 4,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 6,
    marginLeft: 4,
  },
  errorIcon: { marginTop: 2, marginRight: 5 },
  error: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: 'Quicksand_500Medium',
    // dangerDark, not danger: #EF4444 measures ~3.8:1 on white — under the
    // 4.5:1 AA floor for 12px text. Convention: danger for fills/borders,
    // dangerDark for any danger TEXT below 17px.
    color: LightColors.dangerDark,
  },
  validTick: { marginLeft: 8 },
  // Soft red halo around an errored field — the reference's "flagged" look.
  errorGlow: Platform.select({
    ios: {
      shadowColor: LightColors.danger,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.22,
      shadowRadius: 6,
    },
    android: {},
    default: { boxShadow: `0 0 0 3px ${LightColors.danger}1F` },
  }) as any,
  // iOS keyboard "Done" accessory bar — neutral bar, brand-blue action.
  kbdBar: {
    backgroundColor: '#F2F3F5',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: LightColors.dividerStrong,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  kbdDone: {
    color: LightColors.primary,
    fontFamily: 'Quicksand_500Medium',
    fontSize: 16,
  },
});
