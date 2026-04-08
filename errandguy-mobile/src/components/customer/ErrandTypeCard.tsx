import React, { memo } from 'react';
import { View, Text, Pressable } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { formatCurrency } from '../../utils/formatCurrency';

interface ErrandTypeCardProps {
  name: string;
  icon: LucideIcon;
  baseFee: number;
  selected?: boolean;
  onPress: () => void;
}

export const ErrandTypeCard = memo(function ErrandTypeCard({
  name,
  icon: Icon,
  baseFee,
  selected = false,
  onPress,
}: ErrandTypeCardProps) {
  return (
    <Pressable
      className={`items-center justify-center rounded-xl p-4 min-w-[100px] border ${
        selected
          ? 'bg-primaryLight border-primary'
          : 'bg-surface border-divider'
      }`}
      onPress={onPress}
    >
      <Icon size={28} color={selected ? '#2563EB' : '#475569'} />
      <Text
        className={`text-xs font-montserrat-bold mt-2 text-center ${
          selected ? 'text-primary' : 'text-textPrimary'
        }`}
        numberOfLines={2}
      >
        {name}
      </Text>
      <Text className="text-[10px] font-montserrat text-textSecondary mt-1">
        From {formatCurrency(baseFee)}
      </Text>
    </Pressable>
  );
});
