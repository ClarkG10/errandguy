import React from 'react';
import { View, Text } from 'react-native';

interface BookingSectionHeaderProps {
  title: string;
  /** Optional right-aligned fact, e.g. "3.0 km". Numbers render tabular. */
  meta?: React.ReactNode;
}

/**
 * One section title style for the booking funnel (Review's vehicle, fare and
 * payment groups): sentence case, ink, with an optional quiet fact on the
 * right. Sections are separated by spacing, not boxes.
 */
export function BookingSectionHeader({ title, meta }: BookingSectionHeaderProps) {
  return (
    <View className="flex-row items-center justify-between mb-3">
      <Text accessibilityRole="header" className="text-[16px] font-montserrat-bold text-textPrimary">
        {title}
      </Text>
      {meta ? (
        typeof meta === 'string' ? (
          <Text
            className="text-[13px] font-montserrat text-textSecondary ml-3"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {meta}
          </Text>
        ) : (
          meta
        )
      ) : null}
    </View>
  );
}
