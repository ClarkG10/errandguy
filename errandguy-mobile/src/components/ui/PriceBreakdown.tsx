import React from 'react';
import { View, Text } from 'react-native';
import { formatCurrency } from '../../utils/formatCurrency';

interface PriceItem {
  label: string;
  amount: number;
}

interface PriceBreakdownProps {
  items: PriceItem[];
  total: number;
  currency?: string;
}

// Route through the shared en-PH formatter so the breakdown matches the
// Confirm CTA and every other money surface (thousands grouping — the
// old toFixed(2) rendered '₱1234.56' next to a button saying '₱1,234.56').
// The currency prop stays supported for non-peso callers.
function formatAmount(amount: number, currency: string): string {
  const abs = Math.abs(amount);
  if (currency === '₱') return formatCurrency(abs);
  return `${currency}${abs.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Tabular-nums keeps every digit the same advance-width so currency
// columns line up vertically across rows. Without this, ".00" amounts
// drift left of mixed-digit ones and the total looks misaligned.
const moneyStyle = { fontVariant: ['tabular-nums' as const] };

export function PriceBreakdown({
  items,
  total,
  currency = '₱',
}: PriceBreakdownProps) {
  return (
    <View>
      {items.map((item, index) => (
        <View key={index} className="flex-row justify-between py-2">
          {/* Label yields; the amount keeps its intrinsic width so the
              money column never wraps or gets pushed off-row by a long
              promo/fee name. */}
          <Text
            numberOfLines={1}
            className="flex-1 pr-3 text-sm font-montserrat text-textSecondary"
          >
            {item.label}
          </Text>
          {/* successDark, not success — base green is ~3.3:1 on white,
              under the 4.5:1 floor for 13px text (see colors.ts). */}
          <Text
            style={moneyStyle}
            className={`text-sm font-inter ${
              item.amount < 0 ? 'text-successDark' : 'text-textPrimary'
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
          {/* 18px semibold (the heaviest Inter weight the app loads) so
              the committed amount dominates the block over 14px items. */}
          <Text
            style={moneyStyle}
            className="text-[18px] font-inter-semi text-textPrimary"
          >
            {formatAmount(total, currency)}
          </Text>
        </View>
      </View>
    </View>
  );
}
