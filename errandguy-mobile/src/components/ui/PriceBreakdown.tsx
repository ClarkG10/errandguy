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
  /** Show rows whose amount is exactly zero (a "Surcharge ₱0.00"). Off by
   *  default: a zero row is noise the customer has to read past. */
  showZeroRows?: boolean;
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

/**
 * Row labels in sentence case ("Base fee", "Convenience fee"), the app's copy
 * convention. Callers pass the shared `fareLines` vocabulary, which is still
 * Title Case; this keeps every fare table (Review, receipt, detail sheet)
 * saying the same words. Words with an inner capital or digits (GCash, VAT,
 * ErrandGuy) are proper nouns and keep their case.
 */
export function sentenceCaseLabel(label: string): string {
  return label
    .split(' ')
    .map((word, i) => {
      if (i === 0 || word.length === 0) return word;
      const isProperNoun = /[A-Z]/.test(word.slice(1)) || /\d/.test(word);
      return isProperNoun ? word : word.charAt(0).toLowerCase() + word.slice(1);
    })
    .join(' ');
}

// Tabular-nums keeps every digit the same advance-width so currency
// columns line up vertically across rows. Without this, ".00" amounts
// drift left of mixed-digit ones and the total looks misaligned.
const moneyStyle = { fontVariant: ['tabular-nums' as const] };

export function PriceBreakdown({
  items,
  total,
  currency = '₱',
  showZeroRows = false,
}: PriceBreakdownProps) {
  const rows = showZeroRows ? items : items.filter((item) => item.amount !== 0);
  return (
    <View>
      {rows.map((item, index) => (
        <View key={`${item.label}-${index}`} className="flex-row justify-between py-1.5">
          {/* Label yields; the amount keeps its intrinsic width so the
              money column never wraps or gets pushed off-row by a long
              fee or discount label. */}
          <Text
            numberOfLines={1}
            className="flex-1 pr-3 text-[14px] font-montserrat text-textSecondary"
          >
            {sentenceCaseLabel(item.label)}
          </Text>
          {/* successDark, not success — base green is ~3.3:1 on white,
              under the 4.5:1 floor for 13px text (see colors.ts). */}
          <Text
            style={moneyStyle}
            className={`text-[14px] font-inter ${
              item.amount < 0 ? 'text-successDark' : 'text-textPrimary'
            }`}
          >
            {item.amount < 0 ? '-' : ''}
            {formatAmount(item.amount, currency)}
          </Text>
        </View>
      ))}
      {/* The total is the figure the customer commits to, so it is the
          dominant one: larger and heavier than every row above it. */}
      <View
        className={`flex-row items-baseline justify-between ${
          rows.length > 0 ? 'border-t border-divider mt-2 pt-3' : ''
        }`}
        accessible
        accessibilityLabel={`Total, ${formatAmount(total, currency)}`}
      >
        <Text className="text-[15px] font-montserrat-bold text-textPrimary">Total</Text>
        <Text style={moneyStyle} className="text-[24px] font-inter-bold text-textPrimary">
          {formatAmount(total, currency)}
        </Text>
      </View>
    </View>
  );
}
