import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  TextInput,
  Text,
  Pressable,
  Animated,
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

  const floated = focused || (value != null && value.length > 0);
  const anim = useRef(new Animated.Value(floated ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: floated ? 1 : 0,
      duration: 150,
      useNativeDriver: false,
    }).start();
  }, [floated, anim]);

  const labelTop = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [multiline ? 14 : 16, 6],
  });
  const labelSize = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [14, 11],
  });

  const borderColor = error ? '#EF4444' : focused ? '#2563EB' : '#E2E8F0';

  return (
    <View style={fs.wrapper}>
      <Pressable
        style={[
          fs.container,
          { borderColor },
          multiline && fs.multiline,
        ]}
        onPress={() => {}}
      >
        {label && (
          <Animated.Text
            style={[
              fs.label,
              {
                top: labelTop,
                fontSize: labelSize,
                color: error ? '#EF4444' : focused ? '#2563EB' : '#94A3B8',
              },
            ]}
          >
            {label}
          </Animated.Text>
        )}
        <TextInput
          accessibilityLabel={label || placeholder}
          accessibilityState={{ disabled: rest.editable === false }}
          style={[
            fs.input,
            label ? fs.inputWithLabel : null,
            multiline && fs.inputMultiline,
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={floated || !label ? placeholder : ''}
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
            style={fs.toggle}
            onPress={() => setShowPassword(!showPassword)}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <EyeOff size={18} color="#94A3B8" />
            ) : (
              <Eye size={18} color="#94A3B8" />
            )}
          </Pressable>
        )}
        {RightIcon && !isPassword && (
          <RightIcon size={18} color="#94A3B8" style={fs.rightIcon} />
        )}
      </Pressable>
      {error && <Text style={fs.error}>{error}</Text>}
    </View>
  );
}

const fs = StyleSheet.create({
  wrapper: { marginBottom: 16 },
  container: {
    borderWidth: 1.5,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  multiline: { minHeight: 110, alignItems: 'flex-start' },
  label: {
    position: 'absolute',
    left: 16,
    fontFamily: 'Outfit_400Regular',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 4,
    zIndex: 1,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Outfit_400Regular',
    color: '#0F172A',
    paddingVertical: 0,
    paddingTop: 0,
  },
  inputWithLabel: {
    paddingTop: 12,
  },
  inputMultiline: {
    paddingTop: 20,
    minHeight: 80,
  },
  toggle: { position: 'absolute', right: 16, top: 18 },
  rightIcon: { position: 'absolute', right: 16, top: 18 },
  error: {
    fontSize: 12,
    fontFamily: 'Outfit_400Regular',
    color: '#EF4444',
    marginTop: 4,
    marginLeft: 4,
  },
});
