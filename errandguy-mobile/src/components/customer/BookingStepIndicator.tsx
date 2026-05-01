import React from 'react';
import { View, Text, Platform } from 'react-native';

const STEP_LABELS = ['Type', 'Details', 'Schedule', 'Review'] as const;

export type BookingStep = 0 | 1 | 2 | 3;

interface BookingStepIndicatorProps {
  /** Zero-based index of the *current* step (the in-progress one). */
  currentStep: BookingStep;
  /**
   * Optional override of the step labels. Defaults to
   * `['Type', 'Details', 'Schedule', 'Review']`.
   */
  labels?: readonly string[];
  /** Adds horizontal padding to align with screen content. */
  className?: string;
}

/**
 * The single source of truth for the 4-step booking flow indicator.
 *
 * Why this exists:
 * - The previous flow had two visual treatments (one floating-on-map
 *   on `details.tsx`, another in-flow on `schedule.tsx`) and zero
 *   indicator on `type.tsx`/`review.tsx`. Users couldn't tell where
 *   they were in the funnel, and the visual treatment changed
 *   mid-flow which felt broken.
 * - Centralises the labels so adding/renaming a step touches one file.
 * - Uses a connector-line + numbered-circle pattern with explicit
 *   completed/active/upcoming states. Completed steps render a check
 *   glyph instead of the number so the user knows they can navigate
 *   back to revise without losing data.
 * - Exposes proper `accessibilityRole="progressbar"` semantics so
 *   VoiceOver/TalkBack announce the position correctly.
 */
export function BookingStepIndicator({
  currentStep,
  labels = STEP_LABELS,
  className,
}: BookingStepIndicatorProps) {
  return (
    <View
      className={`flex-row items-start ${className ?? ''}`}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${currentStep + 1} of ${labels.length}: ${labels[currentStep]}`}
      accessibilityValue={{ min: 1, max: labels.length, now: currentStep + 1 }}
    >
      {labels.map((label, i) => {
        const isCompleted = i < currentStep;
        const isActive = i === currentStep;
        const isUpcoming = i > currentStep;

        return (
          <React.Fragment key={label}>
            <View className="items-center" style={{ width: 56 }}>
              <View
                className={`w-7 h-7 rounded-full items-center justify-center ${
                  isCompleted || isActive ? 'bg-primary' : 'bg-surface'
                }`}
                style={[
                  isUpcoming ? { borderWidth: 1.5, borderColor: '#E2E8F0' } : null,
                  isActive
                    ? {
                        shadowColor: '#2563EB',
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.25,
                        shadowRadius: 6,
                        elevation: 3,
                      }
                    : null,
                ]}
              >
                {isCompleted ? (
                  <Text
                    style={{
                      color: '#FFFFFF',
                      fontSize: 14,
                      lineHeight: 16,
                      fontWeight: '700',
                      // Use SF Symbols-style checkmark glyph that renders
                      // identically on iOS + Android without an icon dep.
                      fontFamily: Platform.OS === 'ios' ? 'System' : undefined,
                    }}
                  >
                    ✓
                  </Text>
                ) : (
                  <Text
                    className={`text-[11px] font-montserrat-bold ${
                      isActive ? 'text-white' : 'text-textTertiary'
                    }`}
                  >
                    {i + 1}
                  </Text>
                )}
              </View>
              <Text
                numberOfLines={1}
                className={`text-[10px] mt-1.5 ${
                  isActive
                    ? 'font-montserrat-semi text-textPrimary'
                    : isCompleted
                    ? 'font-montserrat text-primary'
                    : 'font-montserrat text-textTertiary'
                }`}
              >
                {label}
              </Text>
            </View>
            {i < labels.length - 1 && (
              <View
                style={{
                  flex: 1,
                  height: 2,
                  backgroundColor: isCompleted ? '#2563EB' : '#E2E8F0',
                  marginTop: 12,
                  borderRadius: 1,
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}
