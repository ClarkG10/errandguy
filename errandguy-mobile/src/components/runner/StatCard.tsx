import React from 'react';
import { View, Text } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

interface StatCardProps {
  icon: LucideIcon;
  value: string | number;
  label: string;
  color?: string;
}

export function StatCard({ icon: Icon, value, label, color = '#2563EB' }: StatCardProps) {
  return (
    <View className="flex-1 bg-surface rounded-xl border border-divider p-3 items-center">
      <Icon size={18} color={color} />
      <Text className="text-lg font-montserrat-bold text-textPrimary mt-1">
        {value}
      </Text>
      <Text className="text-[10px] font-montserrat text-textSecondary mt-0.5">
        {label}
      </Text>
    </View>
  );
}
