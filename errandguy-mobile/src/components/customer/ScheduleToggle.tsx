import React from 'react';
import { View, Text, Pressable } from 'react-native';
import type { ScheduleType } from '../../types';

interface ScheduleToggleProps {
  value: ScheduleType;
  onChange: (value: ScheduleType) => void;
}

export function ScheduleToggle({ value, onChange }: ScheduleToggleProps) {
  return (
    <View className="flex-row gap-3 mb-6">
      <Pressable
        className={`flex-1 rounded-xl border p-5 items-center ${
          value === 'now'
            ? 'bg-primaryLight border-primary'
            : 'bg-surface border-divider'
        }`}
        onPress={() => onChange('now')}
      >
        <Text
          className={`text-base font-montserrat-semi ${
            value === 'now' ? 'text-primary' : 'text-textPrimary'
          }`}
        >
          Now
        </Text>
        <Text className="text-xs font-montserrat text-textSecondary mt-1 text-center">
          Match immediately
        </Text>
      </Pressable>

      <Pressable
        className={`flex-1 rounded-xl border p-5 items-center ${
          value === 'scheduled'
            ? 'bg-primaryLight border-primary'
            : 'bg-surface border-divider'
        }`}
        onPress={() => onChange('scheduled')}
      >
        <Text
          className={`text-base font-montserrat-semi ${
            value === 'scheduled' ? 'text-primary' : 'text-textPrimary'
          }`}
        >
          Schedule
        </Text>
        <Text className="text-xs font-montserrat text-textSecondary mt-1 text-center">
          Pick a date & time
        </Text>
      </Pressable>
    </View>
  );
}
