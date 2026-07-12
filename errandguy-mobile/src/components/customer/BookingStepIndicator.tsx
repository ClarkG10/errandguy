import React from 'react';
import { View, Text } from 'react-native';
import { Check } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';

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
                  // dividerStrong, not divider — the faint hairline is
                  // ~1.06:1 against the #F7F8FA canvas, so upcoming
                  // circles read as floating numbers instead of steps.
                  isUpcoming ? { borderWidth: 1.5, borderColor: LightColors.dividerStrong } : null,
                  isActive
                    ? {
                        shadowColor: LightColors.primary,
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.14,
                        shadowRadius: 8,
                        elevation: 3,
                      }
                    : null,
                ]}
              >
                {isCompleted ? (
                  // Lucide check (not a text glyph) — OEM fonts render '✓'
                  // with inconsistent weight/metrics on Android, and this
                  // is the app's one icon family.
                  <Check
                    size={14}
                    color={LightColors.textInverse}
                    strokeWidth={3}
                  />
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
                  backgroundColor: isCompleted ? LightColors.primary : LightColors.dividerStrong,
                  // Circle is 28px tall — 13 + half the 2px line centres
                  // the connector on the circle midline (y = 14).
                  marginTop: 13,
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
