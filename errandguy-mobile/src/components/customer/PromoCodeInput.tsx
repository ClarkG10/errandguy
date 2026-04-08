import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { X, Check, Tag } from 'lucide-react-native';
import { Input } from '../ui/Input';
import { configService } from '../../services/config.service';

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
      <View className="flex-row items-center bg-success/10 rounded-lg px-4 py-3 mb-4">
        <Tag size={16} color="#22C55E" />
        <Text className="text-sm font-montserrat-bold text-success ml-2 flex-1">
          {appliedCode}
        </Text>
        <Check size={16} color="#22C55E" />
        <Pressable onPress={onRemove} className="ml-2">
          <X size={16} color="#94A3B8" />
        </Pressable>
      </View>
    );
  }

  return (
    <View className="mb-4">
      <View className="flex-row items-end gap-2">
        <View className="flex-1">
          <Input
            label="Promo Code"
            value={code}
            onChangeText={setCode}
            placeholder="Enter promo code"
            error={error}
          />
        </View>
        <Pressable
          className="bg-primary rounded-lg px-4 h-12 items-center justify-center mb-4"
          onPress={handleApply}
          disabled={loading || !code.trim()}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text className="text-sm font-montserrat-bold text-white">
              Apply
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
