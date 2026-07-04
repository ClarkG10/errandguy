import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { X, Check, Tag } from 'lucide-react-native';
import { configService } from '../../services/config.service';
import { LightColors } from '../../constants/colors';

interface PromoCodeInputProps {
  appliedCode: string | undefined;
  onApply: (code: string, discount: number) => void;
  onRemove: () => void;
}

export function PromoCodeInput({
  appliedCode,
  onApply,
  onRemove,
}: PromoCodeInputProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState(false);

  const handleApply = useCallback(async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await configService.validatePromo(code.trim());
      const data = res.data.data;
      onApply(code.trim(), data?.discount_amount ?? 0);
      setCode('');
    } catch (err: any) {
      setError(
        err?.response?.data?.message ?? 'Invalid promo code',
      );
    } finally {
      setLoading(false);
    }
  }, [code, onApply]);

  if (appliedCode) {
    return (
      <View className="flex-row items-center bg-success/10 rounded-2xl px-4 py-3 mb-4">
        <Tag size={16} color={LightColors.success} />
        <Text className="text-sm font-montserrat-bold text-success ml-2 flex-1">
          {appliedCode}
        </Text>
        <Check size={16} color={LightColors.success} />
        <Pressable onPress={onRemove} className="ml-2" hitSlop={8}>
          <X size={16} color={LightColors.textMuted} />
        </Pressable>
      </View>
    );
  }

  // Single bordered row with the Apply button living inline as a
  // right-side adornment. This guarantees pixel-perfect vertical
  // alignment between the input and the button regardless of font
  // metrics or label/error helper height (the previous floating-label
  // Input had a baked-in 16px wrapper margin that visually offset
  // the Apply pill from the field).
  const disabled = loading || !code.trim();

  return (
    <View className="mb-4">
      <View
        className={`flex-row items-center bg-surface rounded-2xl border h-14 pl-4 pr-1 ${
          error
            ? 'border-danger'
            : focused
            ? 'border-primary'
            : 'border-divider'
        }`}
      >
        <Tag size={16} color={LightColors.textMuted} />
        <TextInput
          value={code}
          onChangeText={(t) => {
            setCode(t.toUpperCase());
            if (error) setError('');
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={handleApply}
          placeholder="Enter promo code"
          placeholderTextColor={LightColors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
          className="flex-1 text-sm font-montserrat text-textPrimary mx-2"
          style={{ paddingVertical: 0 }}
        />
        <Pressable
          className={`h-12 px-4 rounded-xl items-center justify-center ${
            disabled ? 'bg-divider' : 'bg-primary'
          }`}
          onPress={handleApply}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Apply promo code"
        >
          {loading ? (
            <ActivityIndicator size="small" color={LightColors.textInverse} />
          ) : (
            <Text
              className={`text-sm font-montserrat-bold ${
                disabled ? 'text-textMuted' : 'text-white'
              }`}
            >
              Apply
            </Text>
          )}
        </Pressable>
      </View>
      {!!error && (
        <Text className="text-xs font-montserrat text-danger mt-1.5 ml-1">
          {error}
        </Text>
      )}
    </View>
  );
}
