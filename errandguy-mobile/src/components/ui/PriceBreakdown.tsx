import React from 'react';
import { View, Text } from 'react-native';

interface PriceItem {
  label: string;
  amount: number;
}

interface PriceBreakdownProps {
  items: PriceItem[];
  total: number;
  currency?: string;
}

function formatAmount(amount: number, currency: string): string {
  return `${currency}${Math.abs(amount).toFixed(2)}`;
}

export function PriceBreakdown({
  items,
  total,
  currency = '₱',
}: PriceBreakdownProps) {
  return (
    <View>
      {items.map((item, index) => (
        <View key={index} className="flex-row justify-between py-2">
          <Text className="text-sm font-montserrat text-textSecondary">
            {item.label}
          </Text>
          <Text
            className={`text-sm font-montserrat ${
              item.amount < 0 ? 'text-success' : 'text-textPrimary'
            }`}
          >
            {item.amount < 0 ? '-' : ''}
            {formatAmount(item.amount, currency)}
          </Text>
        </View>
      ))}
      <View className="border-t border-divider mt-1 pt-3">
        <View className="flex-row justify-between">
          <Text className="text-base font-montserrat-bold text-textPrimary">
            Total
          </Text>
          <Text className="text-base font-montserrat-bold text-textPrimary">
            {formatAmount(total, currency)}
          </Text>
        </View>
      </View>
    </View>
  );
}
