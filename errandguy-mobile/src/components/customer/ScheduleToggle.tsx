import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Zap, Clock } from 'lucide-react-native';
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
        <Zap
          size={32}
          color={value === 'now' ? '#2563EB' : '#94A3B8'}
          fill={value === 'now' ? '#2563EB' : 'transparent'}
        />
        <Text
          className={`text-base font-montserrat-bold mt-3 ${
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
        <Clock
          size={32}
          color={value === 'scheduled' ? '#2563EB' : '#94A3B8'}
        />
        <Text
          className={`text-base font-montserrat-bold mt-3 ${
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
