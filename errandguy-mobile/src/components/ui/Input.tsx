import React, { useState, useRef } from 'react';
import {
  View,
  TextInput,
  Text,
  Pressable,
  StyleSheet,
  type TextInputProps,
} from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

interface InputProps extends Omit<TextInputProps, 'onChange'> {
  label?: string;
  error?: string;
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
}

/**
 * Form input with a static caption-style label.
 *
 * The previous version used `Animated` to float the label between two
 * positions, but with `useNativeDriver: false` it forced a layout pass
 * on every keystroke, which the user perceived as a glitch (label
 * jitter, cursor jump). A static caption label removes the animation
 * entirely and matches what iOS / Material 3 ship today.
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

  const borderColor = error ? '#EF4444' : focused ? '#2563EB' : '#E2E8F0';
  const labelColor = error ? '#EF4444' : focused ? '#2563EB' : '#64748B';

  return (
    <View style={fs.wrapper}>
      {label && (
        <Text style={[fs.label, { color: labelColor }]}>{label}</Text>
      )}
      <Pressable
        style={[
          fs.container,
          { borderColor },
          multiline && fs.multiline,
        ]}
        onPress={() => inputRef.current?.focus()}
      >
        {LeftIcon && (
          <LeftIcon size={18} color="#94A3B8" style={{ marginRight: 10 }} />
        )}
        <TextInput
          ref={inputRef}
          accessibilityLabel={label || placeholder}
          accessibilityState={{ disabled: rest.editable === false }}
          style={[fs.input, multiline && fs.inputMultiline]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#CBD5E1"
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
              <EyeOff size={18} color="#94A3B8" />
            ) : (
              <Eye size={18} color="#94A3B8" />
            )}
          </Pressable>
        )}
        {RightIcon && !isPassword && (
          <RightIcon size={18} color="#94A3B8" style={{ marginLeft: 8 }} />
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
    fontSize: 12,
    fontFamily: 'Quicksand_600SemiBold',
    marginBottom: 6,
    marginLeft: 2,
  },
  container: {
    borderWidth: 1.5,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  multiline: { minHeight: 96, alignItems: 'flex-start', paddingVertical: 12 },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Quicksand_400Regular',
    color: '#0F172A',
    paddingVertical: 0,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  error: {
    fontSize: 12,
    fontFamily: 'Quicksand_400Regular',
    color: '#EF4444',
    marginTop: 4,
    marginLeft: 4,
  },
});
