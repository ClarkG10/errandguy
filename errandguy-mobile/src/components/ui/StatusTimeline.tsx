import React from 'react';
import { View, Text } from 'react-native';

interface Step {
  label: string;
  timestamp?: string;
  status: 'completed' | 'current' | 'pending';
}

interface StatusTimelineProps {
  steps: Step[];
  currentStep?: number;
}

export function StatusTimeline({ steps, currentStep }: StatusTimelineProps) {
  return (
    <View className="pl-2">
      {steps.map((step, index) => {
        const isCompleted = step.status === 'completed';
        const isCurrent = step.status === 'current';
        const isLast = index === steps.length - 1;

        return (
          <View key={index} className="flex-row">
            <View className="items-center mr-3">
              <View
                className={`w-3 h-3 rounded-full ${
                  isCompleted
                    ? 'bg-primary'
                    : isCurrent
                      ? 'bg-primary border-2 border-primaryLight'
                      : 'bg-divider'
                }`}
              />
              {!isLast && (
                <View
                  className={`w-0.5 flex-1 min-h-[24px] ${
                    isCompleted ? 'bg-primary' : 'bg-divider'
                  }`}
                />
              )}
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
