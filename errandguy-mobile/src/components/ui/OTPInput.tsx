import React, { useEffect, useRef } from 'react';
import { View, TextInput, Text, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface OTPInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function OTPInput({ length = 6, value, onChange, error }: OTPInputProps) {
  const inputs = useRef<(TextInput | null)[]>([]);
  const digits = value.split('').concat(Array(length - value.length).fill(''));

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
        className="flex-row justify-center gap-3"
        accessibilityRole="text"
        accessibilityLabel={`One-time code, ${length} digits`}
      >
        {Array.from({ length }).map((_, index) => (
          <TextInput
            key={index}
            ref={(ref) => {
              inputs.current[index] = ref;
            }}
            accessibilityLabel={`Digit ${index + 1} of ${length}`}
            className={`w-12 h-14 border rounded-lg text-center text-xl font-montserrat-bold text-textPrimary bg-surface ${
              error ? 'border-danger' : digits[index] ? 'border-primary' : 'border-divider'
            }`}
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
        ))}
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
