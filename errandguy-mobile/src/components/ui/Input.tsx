import React, { useState } from 'react';
import {
  View,
  TextInput,
  Text,
  Pressable,
  type TextInputProps,
  type KeyboardTypeOptions,
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
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = secureTextEntry !== undefined;

  return (
    <View className="mb-4">
      {label && (
        <Text className="text-sm font-montserrat-bold text-textPrimary mb-1.5">
          {label}
        </Text>
      )}
      <View
        className={`flex-row items-center border rounded-lg px-4 ${
          error ? 'border-danger' : 'border-divider'
        } ${multiline ? 'min-h-[100px] items-start' : 'h-12'} bg-surface`}
      >
        {LeftIcon && (
          <LeftIcon size={20} color="#475569" style={{ marginRight: 8 }} />
        )}
        <TextInput
          className="flex-1 text-base font-montserrat text-textPrimary"
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#94A3B8"
          secureTextEntry={isPassword && !showPassword}
          keyboardType={keyboardType}
          maxLength={maxLength}
          multiline={multiline}
          numberOfLines={numberOfLines}
          textAlignVertical={multiline ? 'top' : 'center'}
          {...rest}
        />
        {isPassword && (
          <Pressable onPress={() => setShowPassword(!showPassword)}>
            {showPassword ? (
              <EyeOff size={20} color="#475569" />
            ) : (
              <Eye size={20} color="#475569" />
            )}
          </Pressable>
        )}
        {RightIcon && !isPassword && (
          <RightIcon size={20} color="#475569" style={{ marginLeft: 8 }} />
        )}
      </View>
      {error && (
        <Text className="text-xs text-danger mt-1 font-montserrat">{error}</Text>
      )}
    </View>
  );
}
