import React, { useEffect, useRef, useState } from 'react';
import { View, TextInput, Text, Platform, AccessibilityInfo } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useResponsive } from '../../constants/responsive';
import { LightColors } from '../../constants/colors';

interface OTPInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  /** Green confirmation state — set briefly by the parent after a
   * successful verify so the cells acknowledge success before the
   * route swap (mirrors the error color ladder). */
  success?: boolean;
}

export function OTPInput({ length = 6, value, onChange, error, success }: OTPInputProps) {
  const inputs = useRef<(TextInput | null)[]>([]);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const digits = value.split('').concat(Array(length - value.length).fill(''));
  const { mScale, width: screenW, contentMaxWidth } = useResponsive();

  // Cell sizing — prefer the moderate-scaled 48pt design width, but
  // step down on narrow phones so 6 cells + margins always fit inside
  // the available content column without overflowing horizontally.
  // 24pt of side padding is reserved on each edge to match the form
  // container and to leave room for the cells' shadow/border.
  const designCellW = mScale(48);
  const cellMargin = mScale(4);
  const horizontalPad = mScale(24);
  const usableW = Math.min(screenW, contentMaxWidth) - horizontalPad * 2;
  const cellWidth = Math.max(
    32,
    Math.min(designCellW, Math.floor(usableW / length) - cellMargin * 2),
  );
  const cellHeight = Math.round(cellWidth * 1.25); // keep 4:5 ratio
  const cellFont = Math.max(16, Math.round(cellWidth * 0.46));

  // On narrow phones the cells can shrink below the 44pt minimum touch
  // target — pad the difference back with hitSlop (no layout impact).
  const vSlop = Math.max(0, Math.ceil((44 - cellHeight) / 2));
  const hSlop = Math.max(0, Math.ceil((44 - cellWidth) / 2));

  // Shake the cell row whenever an error message appears. We key off the
  // string itself so re-submitting the same wrong code still shakes (the
  // parent should bump the error reference / message in that case).
  // Under OS Reduce Motion the shake is skipped — the error haptic and
  // red cells still communicate the failure.
  const reduceMotion = useReducedMotion();
  const shake = useSharedValue(0);
  useEffect(() => {
    if (!error) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    // accessibilityLiveRegion is Android-only — announce explicitly on iOS
    // so VoiceOver users hear why their code was rejected.
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(error);
    }
    // After a failed verify the parent clears the code, but focus is left
    // on the last cell while new digits render into the first — refocus
    // cell 1 so the caret and the visible input point agree on the retry.
    requestAnimationFrame(() => inputs.current[0]?.focus());
    if (reduceMotion) return;
    shake.value = withSequence(
      withTiming(-8, { duration: 50, easing: Easing.linear }),
      withTiming(8, { duration: 50, easing: Easing.linear }),
      withTiming(-6, { duration: 50, easing: Easing.linear }),
      withTiming(6, { duration: 50, easing: Easing.linear }),
      withTiming(0, { duration: 50, easing: Easing.linear }),
    );
  }, [error, shake, reduceMotion]);
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value }],
  }));

  // Auto-focus the first cell on mount so the keyboard pops up immediately
  // and the user doesn't have to tap. Critical on iOS where SMS autofill
  // only works when the field is the focused/keyboard-active input.
  useEffect(() => {
    const t = setTimeout(() => inputs.current[0]?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const handleChange = (text: string, index: number) => {
    // Sanitize to digits only — pasted strings sometimes carry stray
    // formatting (`123-456`, spaces, NBSP from SMS senders).
    const sanitized = text.replace(/\D/g, '');

    // Subtle tick per digit entered (single fire for a full paste too).
    if (sanitized) {
      Haptics.selectionAsync().catch(() => {});
    }

    // SMS autofill / clipboard paste: iOS delivers the full code into the
    // first cell's onChangeText in a single call. Distribute across cells.
    if (sanitized.length > 1) {
      const next = (value.slice(0, index) + sanitized).slice(0, length);
      onChange(next);
      const focusIdx = Math.min(next.length, length - 1);
      // Defer focus so the value commit happens first; otherwise the
      // freshly focused cell can swallow the previous keystroke on iOS.
      requestAnimationFrame(() => inputs.current[focusIdx]?.focus());
      return;
    }

    const newDigits = [...digits];
    newDigits[index] = sanitized;
    const newValue = newDigits.join('').slice(0, length);
    onChange(newValue);

    if (sanitized && index < length - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
      const newDigits = [...digits];
      newDigits[index - 1] = '';
      onChange(newDigits.join('').slice(0, length));
    }
  };

  return (
    <View>
      <Animated.View
        style={shakeStyle}
        className="flex-row justify-center"
        accessibilityRole="text"
        accessibilityLabel={`One-time code, ${length} digits`}
      >
        {Array.from({ length }).map((_, index) => {
          // Filled-style OTP cell matching Input: muted fill at rest
          // (no visible border), white + ink border once a digit lands
          // so the eye reads progress at a glance, and a primary ring on
          // the focused cell so the user can see where input lands. Inter
          // tabular numerics match every other numeric in the app.
          const filled = !!digits[index];
          const focused = focusedIndex === index;
          const borderColor = error
            ? LightColors.danger
            : success
              ? LightColors.success
              : focused
                ? LightColors.primary
                : filled
                  ? LightColors.textPrimary
                  : 'transparent';
          const bg = error
            ? LightColors.dangerSoft
            : success
              ? LightColors.successLight
              : focused || filled
                ? LightColors.surface
                : LightColors.surfaceMuted;
          return (
          <TextInput
            key={index}
            ref={(ref) => {
              inputs.current[index] = ref;
            }}
            accessibilityLabel={`Digit ${index + 1} of ${length}`}
            style={{
              width: cellWidth,
              height: cellHeight,
              marginHorizontal: cellMargin,
              borderWidth: filled || focused ? 2 : 1.5,
              borderRadius: 16,
              borderColor,
              backgroundColor: bg,
              textAlign: 'center',
              fontSize: cellFont,
              fontFamily: Platform.OS === 'ios' ? 'Inter_600SemiBold' : 'Quicksand_700Bold',
              color: LightColors.textPrimary,
              padding: 0,
            }}
            value={digits[index]}
            onChangeText={(text) => handleChange(text, index)}
            onKeyPress={(e) => handleKeyPress(e, index)}
            onFocus={() => setFocusedIndex(index)}
            onBlur={() => setFocusedIndex((i) => (i === index ? null : i))}
            hitSlop={{ top: vSlop, bottom: vSlop, left: hSlop, right: hSlop }}
            keyboardType="number-pad"
            // SMS autofill: only the FIRST cell advertises the
            // one-time-code semantic to iOS / Android Autofill. iOS
            // pastes the entire code into this cell — handleChange()
            // above splits it back across the row.
            textContentType={
              Platform.OS === 'ios' && index === 0 ? 'oneTimeCode' : 'none'
            }
            autoComplete={
              Platform.OS === 'android' && index === 0 ? 'sms-otp' : 'off'
            }
            importantForAutofill={index === 0 ? 'yes' : 'noExcludeDescendants'}
            // Allow long-press paste on every cell so users can paste
            // a code copied from a different app (1Password, etc.) into
            // any cell and we'll still distribute it correctly.
            contextMenuHidden={false}
            // Cap to length so a single-cell paste of >1 char hits the
            // multi-paste branch above instead of being silently dropped.
            maxLength={length}
            selectTextOnFocus
          />
          );
        })}
      </Animated.View>
      {/* Always rendered (minHeight reserves the line) so the CTA below
          never jumps when an error appears or clears. dangerDark: base
          danger fails 4.5:1 at this size on white. */}
      <Text
        accessibilityLiveRegion="polite"
        className="text-xs text-dangerDark mt-2 text-center font-montserrat"
        style={{ minHeight: 18 }}
      >
        {error ?? ''}
      </Text>
    </View>
  );
}
