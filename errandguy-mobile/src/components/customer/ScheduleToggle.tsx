import React from 'react';
import { View, Text, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LightColors, Elevation } from '../../constants/colors';
import type { ScheduleType } from '../../types';

interface ScheduleToggleProps {
  value: ScheduleType;
  onChange: (value: ScheduleType) => void;
}

const OPTIONS: {
  key: ScheduleType;
  title: string;
  sub: string;
  accessibilityLabel: string;
}[] = [
  {
    key: 'now',
    title: 'Now',
    sub: 'Match immediately',
    accessibilityLabel: 'Now. Match immediately',
  },
  {
    key: 'scheduled',
    title: 'Schedule',
    sub: 'Pick a date & time',
    accessibilityLabel: 'Schedule. Pick a date and time',
  },
];

export function ScheduleToggle({ value, onChange }: ScheduleToggleProps) {
  const select = (next: ScheduleType) => {
    if (next !== value) Haptics.selectionAsync().catch(() => {});
    onChange(next);
  };

  return (
    <View
      className="flex-row gap-3 mb-6"
      accessibilityRole="radiogroup"
      accessibilityLabel="When should the errand start"
    >
      {OPTIONS.map((opt) => {
        const isSelected = value === opt.key;
        return (
          <Pressable
            key={opt.key}
            accessibilityRole="radio"
            accessibilityLabel={opt.accessibilityLabel}
            accessibilityState={{ checked: isSelected, selected: isSelected }}
            // justify-center: the row stretches both cards to the taller
            // one's height when a sub-line wraps on narrow phones — keep
            // the shorter card's content vertically centered, not pinned
            // to the top.
            className="flex-1 rounded-xl p-5 items-center justify-center"
            // Selection = soft blue tint + a 2px brand border, matching the
            // errand-type grid. Content stays DARK on a LIGHT ground in both
            // states — never inverted to white (which repeatedly regressed to
            // invisible white-on-white). Constant border width so toggling
            // never shifts the card's content.
            style={({ pressed }) => [
              {
                borderWidth: 1.5,
                borderColor: isSelected ? LightColors.primary : LightColors.divider,
                backgroundColor: isSelected ? LightColors.primaryLight : LightColors.surface,
              },
              isSelected ? Elevation.md : Elevation.sm,
              pressed && { opacity: 0.92, transform: [{ scale: 0.985 }] },
            ]}
            android_ripple={{ color: `${LightColors.primary}14` }}
            onPress={() => select(opt.key)}
          >
            <Text
              className="text-base font-montserrat-semi"
              style={{
                color: isSelected ? LightColors.primaryDark : LightColors.textPrimary,
              }}
            >
              {opt.title}
            </Text>
            <Text
              className="text-xs font-montserrat mt-1 text-center"
              style={{ color: LightColors.textSecondary }}
            >
              {opt.sub}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
