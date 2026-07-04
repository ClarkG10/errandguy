import React from 'react';
import { View, Text } from 'react-native';
import { LightColors } from '../../constants/colors';

interface Step {
  label: string;
  timestamp?: string;
  status: 'completed' | 'current' | 'pending';
}

interface StatusTimelineProps {
  steps: Step[];
  currentStep?: number;
}

/**
 * Trip timeline — ride-hailing pattern: rounded-square stop markers
 * joined by a dashed connector (rendered as a column of short dash
 * segments, since RN has no dashed-border-on-one-side). Completed /
 * current stops carry an ink-dark or brand-blue marker; pending stops
 * stay quiet. Timestamps right-align at the row level in consumers
 * that need them; here they sit under the label.
 */
const MARKER = 18;
const DASH_COUNT = 4;

function DashedConnector({ active }: { active: boolean }) {
  return (
    <View className="items-center flex-1" style={{ minHeight: 26, paddingVertical: 3 }}>
      {Array.from({ length: DASH_COUNT }).map((_, i) => (
        <View
          key={i}
          style={{
            width: 2,
            flex: 1,
            marginVertical: 1.5,
            borderRadius: 1,
            backgroundColor: active ? LightColors.primary : LightColors.dividerStrong,
          }}
        />
      ))}
    </View>
  );
}

export function StatusTimeline({ steps, currentStep }: StatusTimelineProps) {
  return (
    <View className="pl-1">
      {steps.map((step, index) => {
        const isCompleted = step.status === 'completed';
        const isCurrent = step.status === 'current';
        const isLast = index === steps.length - 1;

        return (
          <View key={index} className="flex-row">
            <View className="items-center mr-3" style={{ width: MARKER }}>
              <View
                style={{
                  width: MARKER,
                  height: MARKER,
                  borderRadius: 6,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isCurrent
                    ? LightColors.primary
                    : isCompleted
                      ? LightColors.ink
                      : LightColors.divider,
                }}
              >
                <View
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 2.5,
                    backgroundColor:
                      isCompleted || isCurrent
                        ? LightColors.textInverse
                        : LightColors.textMuted,
                  }}
                />
              </View>
              {!isLast && <DashedConnector active={isCompleted} />}
            </View>
            <View className={`flex-1 ${!isLast ? 'pb-4' : ''}`}>
              <Text
                className={`text-sm font-montserrat ${
                  isCompleted || isCurrent
                    ? 'text-textPrimary font-montserrat-bold'
                    : 'text-textSecondary'
                }`}
              >
                {step.label}
              </Text>
              {step.timestamp && (
                <Text className="text-xs text-textSecondary font-montserrat mt-0.5">
                  {step.timestamp}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}
