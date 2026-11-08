import React, { useEffect } from 'react';
import { View, Text, ScrollView, AccessibilityInfo } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SuccessCheck } from '../../ui/SuccessCheck';
import { Button } from '../../ui/Button';
import { LightColors } from '../../../constants/colors';
import { useResponsive } from '../../../constants/responsive';

export interface BookingSuccessRow {
  label: string;
  value: string;
}

interface BookingSuccessProps {
  /** Specific headline: "Errand booked", "Errand scheduled". */
  title: string;
  /** The quiet facts line, joined with " · " (booking no. · amount · method).
   *  Empty parts are dropped. */
  facts: Array<string | null | undefined | false>;
  /** Key details, one per hairline-separated row ("Pickup" → address). */
  rows: BookingSuccessRow[];
  /** What happens next — rendered under the rows. */
  next?: React.ReactNode;
  primary: { title: string; onPress: () => void; accessibilityHint?: string };
  secondary?: { title: string; onPress: () => void };
  /** Anything quieter after the two actions (e.g. a "Cancel errand" link). */
  footer?: React.ReactNode;
  /** Said once to screen readers when this appears. */
  announcement?: string;
  /** Success haptic from the check. Off where the caller already fired one. */
  haptic?: boolean;
}

/**
 * The booking funnel's success screen: confirm, reassure, then show what
 * happens next. A big green check in a soft green circle, a specific
 * headline, one quiet line of facts, the key details on hairline-separated
 * rows, then one primary and one outline action. White and calm.
 */
export function BookingSuccess({
  title,
  facts,
  rows,
  next,
  primary,
  secondary,
  footer,
  announcement,
  haptic = true,
}: BookingSuccessProps) {
  const insets = useSafeAreaInsets();
  const { contentMaxWidth } = useResponsive();
  const factsLine = facts.filter(Boolean).join(' · ');

  useEffect(() => {
    if (announcement) AccessibilityInfo.announceForAccessibility(announcement);
    // Once, on arrival — the headline is what the customer waited for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: LightColors.surface }}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: 'center',
        paddingHorizontal: 24,
        paddingTop: insets.top + 24,
        paddingBottom: Math.max(insets.bottom, 16) + 16,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ width: '100%', maxWidth: Math.min(contentMaxWidth, 440), alignSelf: 'center' }}>
        <View
          style={{
            alignSelf: 'center',
            width: 112,
            height: 112,
            borderRadius: 56,
            backgroundColor: LightColors.successLight,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SuccessCheck size={72} haptic={haptic} />
        </View>

        <Text
          accessibilityRole="header"
          className="text-[26px] font-montserrat-bold text-textPrimary text-center mt-6"
        >
          {title}
        </Text>
        {factsLine ? (
          <Text
            className="text-[14px] font-montserrat text-textSecondary text-center mt-2"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {factsLine}
          </Text>
        ) : null}

        {rows.length > 0 && (
          <View className="mt-7">
            {rows.map((row) => (
              <View
                key={row.label}
                className="flex-row items-start justify-between border-b border-divider"
                style={{ paddingVertical: 14, gap: 16 }}
                accessible
                accessibilityLabel={`${row.label}: ${row.value}`}
              >
                <Text className="text-[14px] font-montserrat text-textSecondary">{row.label}</Text>
                <Text
                  className="text-[14px] font-montserrat-bold text-textPrimary text-right"
                  style={{ flexShrink: 1, fontVariant: ['tabular-nums'] }}
                  numberOfLines={2}
                >
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        )}

        {next ? <View className="mt-5">{next}</View> : null}

        <View className="mt-7" style={{ gap: 12 }}>
          <Button
            title={primary.title}
            onPress={primary.onPress}
            accessibilityHint={primary.accessibilityHint}
            fullWidth
          />
          {secondary ? (
            <Button title={secondary.title} variant="outline" onPress={secondary.onPress} fullWidth />
          ) : null}
        </View>
        {footer ? <View className="mt-2">{footer}</View> : null}
      </View>
    </ScrollView>
  );
}
