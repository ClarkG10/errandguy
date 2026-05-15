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
  const { mScale } = useResponsive();

  // Blue focus ring — the previous slate ring read as inert. The
  // brand-blue glow signals "active" and ties the form back to the
  // primary CTA below it.
  const borderColor = error ? '#EF4444' : focused ? '#2563EB' : '#E6EBF2';
  const labelColor = error ? '#EF4444' : '#475569';

  // Responsive sizing — slightly tighter than the previous 50pt slab
  // so the field reads as part of the modernised, lighter design
  // language. Still well above the 44pt touch-target minimum.
  const minH = mScale(46);
  const minHMulti = mScale(92);
  const padH = mScale(14);
  const labelSize = mScale(11);
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
          { borderColor, minHeight: minH, paddingHorizontal: padH },
          focused && !error ? fs.focusedShadow : null,
          multiline && [fs.multiline, { minHeight: minHMulti }],
        ]}
        onPress={() => inputRef.current?.focus()}
      >
        {LeftIcon && (
          <LeftIcon size={iconSize} color="#94A3B8" style={{ marginRight: 10 }} />
        )}
        <TextInput
          ref={inputRef}
          accessibilityLabel={label || placeholder}
          accessibilityState={{ disabled: rest.editable === false }}
          style={[fs.input, { fontSize: inputSize }, multiline && fs.inputMultiline]}
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
              <EyeOff size={iconSize} color="#94A3B8" />
            ) : (
              <Eye size={iconSize} color="#94A3B8" />
            )}
          </Pressable>
        )}
        {RightIcon && !isPassword && (
          <RightIcon size={iconSize} color="#94A3B8" style={{ marginLeft: 8 }} />
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
    fontFamily: 'Quicksand_700Bold',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 2,
  },
  container: {
    borderWidth: 1,
    // 12px to match Button + tile radii. The previous 14px combined
    // with 1.5px border made every form field read as a fat pill.
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Soft brand-blue focus ring — visually echoes the primary CTA
  // and reinforces the blue-first identity without screaming.
  focusedShadow: Platform.select({
    ios: {
      shadowColor: '#2563EB',
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
