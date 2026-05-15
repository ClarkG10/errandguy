import React, { useEffect, useRef } from 'react';
import { View, TextInput, Text, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useResponsive } from '../../constants/responsive';

interface OTPInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function OTPInput({ length = 6, value, onChange, error }: OTPInputProps) {
  const inputs = useRef<(TextInput | null)[]>([]);
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

  // Shake the cell row whenever an error message appears. We key off the
  // string itself so re-submitting the same wrong code still shakes (the
  // parent should bump the error reference / message in that case).
  const shake = useSharedValue(0);
  useEffect(() => {
    if (!error) return;
    shake.value = withSequence(
      withTiming(-8, { duration: 50, easing: Easing.linear }),
      withTiming(8, { duration: 50, easing: Easing.linear }),
      withTiming(-6, { duration: 50, easing: Easing.linear }),
      withTiming(6, { duration: 50, easing: Easing.linear }),
      withTiming(0, { duration: 50, easing: Easing.linear }),
    );
  }, [error, shake]);
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
          // Modern OTP cell: larger 52×62 box with Inter tabular numerics
          // (matches every other numeric in the app), 12px radius, and a
          // 2px ink-dark border on a filled cell so the eye reads progress
          // at a glance. Filled cells lift onto a soft surface tint.
          const filled = !!digits[index];
          const borderColor = error
            ? '#EF4444'
            : filled
              ? '#0F172A'
              : '#E2E8F0';
          const bg = error
            ? '#FEF2F2'
            : filled
              ? '#F8FAFC'
              : '#FFFFFF';
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
              borderWidth: filled ? 2 : 1,
              borderRadius: 12,
              borderColor,
              backgroundColor: bg,
              textAlign: 'center',
              fontSize: cellFont,
              fontFamily: Platform.OS === 'ios' ? 'Inter_600SemiBold' : 'Quicksand_700Bold',
              color: '#0F172A',
              padding: 0,
            }}
            value={digits[index]}
            onChangeText={(text) => handleChange(text, index)}
            onKeyPress={(e) => handleKeyPress(e, index)}
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
      {error && (
        <Text
          accessibilityLiveRegion="polite"
          className="text-xs text-danger mt-2 text-center font-montserrat"
        >
          {error}
        </Text>
      )}
    </View>
  );
}
