import React from 'react';
import { View, Text } from 'react-native';

interface PerformanceMetricProps {
  value: number;
  label: string;
  color?: string;
  suffix?: string;
}

export function PerformanceMetric({
  value,
  label,
  color = '#2563EB',
  suffix = '%',
}: PerformanceMetricProps) {
  const displayValue = suffix === '%' ? Math.round(value) : value;

  return (
    <View className="flex-1 items-center">
      <View
        className="w-16 h-16 rounded-full border-4 items-center justify-center"
        style={{ borderColor: color }}
      >
        <Text className="text-sm font-montserrat-bold" style={{ color }}>
          {displayValue}
          {suffix}
        </Text>
      </View>
      <Text className="text-[10px] font-montserrat text-textSecondary mt-1 text-center">
        {label}
      </Text>
    </View>
  );
}
