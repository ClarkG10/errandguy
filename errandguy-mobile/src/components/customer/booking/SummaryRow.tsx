import React from 'react';
import { View, Text } from 'react-native';
import { LightColors } from '../../../constants/colors';
import { PressableScale } from './PressableScale';

interface SummaryRowProps {
  /** Small caption above the value ("Pickup", "When"). Sentence case. */
  label: string;
  value: string;
  /** Leading marker (a route dot) — rows without one keep the same left edge. */
  marker?: React.ReactNode;
  /** Trailing link text ("Edit", "Schedule for later"). Needs `onPress`. */
  action?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Lines the value may wrap to before truncating. Addresses get two. */
  valueLines?: number;
}

/** Width of the marker column, so every row's text starts on one left edge. */
export const SUMMARY_MARKER_WIDTH = 22;

/**
 * One read-back row on Review: caption over value on the left, an optional
 * action link on the right. Every row shares the marker column and the link
 * column, so "Edit" links line up down the screen. The whole row is the
 * touch target (≥ 48pt) when it has an action.
 */
export function SummaryRow({
  label,
  value,
  marker,
  action,
  onPress,
  accessibilityLabel,
  valueLines = 2,
}: SummaryRowProps) {
  const body = (
    <>
      <View style={{ width: SUMMARY_MARKER_WIDTH }}>{marker}</View>
      <View style={{ flex: 1 }}>
        <Text className="text-[12px] font-montserrat text-textSecondary">{label}</Text>
        <Text
          className="text-[15px] font-montserrat-semi text-textPrimary mt-0.5"
          numberOfLines={valueLines}
        >
          {value}
        </Text>
      </View>
      {action ? (
        <Text className="text-[14px] font-montserrat-bold text-primary ml-4">{action}</Text>
      ) : null}
    </>
  );

  const rowStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    minHeight: 52,
    paddingVertical: 8,
  };

  if (!onPress) {
    return (
      <View style={rowStyle} accessible accessibilityLabel={accessibilityLabel ?? `${label}: ${value}`}>
        {body}
      </View>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      pressedScale={1}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label}: ${value}. ${action ?? ''}`.trim()}
      android_ripple={{ color: `${LightColors.primary}14`, borderless: false }}
      contentStyle={rowStyle}
    >
      {body}
    </PressableScale>
  );
}
