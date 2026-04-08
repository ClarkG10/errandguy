import React, { useRef } from 'react';
import { View, TextInput, Text } from 'react-native';

interface OTPInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function OTPInput({ length = 6, value, onChange, error }: OTPInputProps) {
  const inputs = useRef<(TextInput | null)[]>([]);
  const digits = value.split('').concat(Array(length - value.length).fill(''));

  const handleChange = (text: string, index: number) => {
    const newDigits = [...digits];
    newDigits[index] = text;
    const newValue = newDigits.join('').slice(0, length);
    onChange(newValue);

    if (text && index < length - 1) {
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
      <View className="flex-row justify-center gap-3">
        {Array.from({ length }).map((_, index) => (
          <TextInput
            key={index}
            ref={(ref) => {
              inputs.current[index] = ref;
            }}
            className={`w-12 h-14 border rounded-lg text-center text-xl font-montserrat-bold text-textPrimary bg-surface ${
              error ? 'border-danger' : digits[index] ? 'border-primary' : 'border-divider'
            }`}
            value={digits[index]}
            onChangeText={(text) => handleChange(text, index)}
            onKeyPress={(e) => handleKeyPress(e, index)}
            keyboardType="number-pad"
            maxLength={1}
            selectTextOnFocus
          />
        ))}
      </View>
      {error && (
        <Text className="text-xs text-danger mt-2 text-center font-montserrat">
          {error}
        </Text>
      )}
    </View>
  );
}
