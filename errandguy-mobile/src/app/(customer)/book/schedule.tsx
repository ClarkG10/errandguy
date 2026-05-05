import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Info, Zap } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import dayjs from 'dayjs';
import { useBookingStore } from '../../../stores/bookingStore';
import { Button } from '../../../components/ui/Button';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { ScheduleToggle } from '../../../components/customer/ScheduleToggle';
import { DateTimePicker } from '../../../components/customer/DateTimePicker';
import { BookingStepIndicator } from '../../../components/customer/BookingStepIndicator';
import type { ScheduleType } from '../../../types';

// Legacy local labels kept only as documentation of the canonical order.
// All step UI is now driven by `BookingStepIndicator`.

/**
 * Convenience presets shown above the wheel picker. The labels are
 * resolved each render so "Tonight 7 PM" doesn't suggest a time that's
 * already past on the device clock — past presets are filtered out.
 */
function buildQuickPicks(now: dayjs.Dayjs) {
  const picks: { label: string; value: dayjs.Dayjs; sublabel: string }[] = [];

  const inAnHour = now.add(1, 'hour').minute(0).second(0);
  if (inAnHour.isAfter(now.add(30, 'minute'))) {
    picks.push({
      label: 'In 1 hour',
      sublabel: inAnHour.format('h:mm A'),
      value: inAnHour,
    });
  }

  const tonightSeven = now.hour(19).minute(0).second(0);
  if (tonightSeven.isAfter(now.add(30, 'minute'))) {
    picks.push({
      label: 'Tonight',
      sublabel: '7:00 PM',
      value: tonightSeven,
    });
  }

  const tomorrowMorning = now.add(1, 'day').hour(9).minute(0).second(0);
  picks.push({
    label: 'Tomorrow',
    sublabel: '9:00 AM',
    value: tomorrowMorning,
  });

  const tomorrowNoon = now.add(1, 'day').hour(12).minute(0).second(0);
  picks.push({
    label: 'Tomorrow',
    sublabel: '12:00 PM',
    value: tomorrowNoon,
  });

  return picks;
}

export default function ScheduleScreen() {
  const router = useRouter();
  const { draftBooking, updateDraft, setStep } = useBookingStore();

  const [scheduleType, setScheduleType] = useState<ScheduleType>(
    draftBooking.schedule_type ?? 'now',
  );

  const handleScheduleChange = useCallback(
    (type: ScheduleType) => {
      setScheduleType(type);
      updateDraft({
        schedule_type: type,
        scheduled_at: type === 'now' ? undefined : draftBooking.scheduled_at,
      });
    },
    [updateDraft, draftBooking.scheduled_at],
  );

  // Quick presets (computed once per render — cheap; refreshes if the
  // user lingers and a preset becomes invalid we'll recompute on
  // navigation).
  const quickPicks = useMemo(() => buildQuickPicks(dayjs()), []);
  const selectedIso = draftBooking.scheduled_at;

  const handleContinue = useCallback(() => {
    updateDraft({ schedule_type: scheduleType });
    setStep(3);
    router.push('/(customer)/book/review');
  }, [scheduleType, updateDraft, setStep, router]);

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="When?" showBack fallbackHref="/(customer)/(tabs)">
        <View className="px-5 -mt-2 pb-3">
          <Text
            className="text-[10px] font-montserrat-bold uppercase"
            style={{ letterSpacing: 1.4, color: 'rgba(255,255,255,0.78)' }}
          >
            New errand · Step 3
          </Text>
        </View>
      </GradientHeader>

      {/* Step Indicator */}
      <View className="px-5 mt-3 mb-4">
        <BookingStepIndicator currentStep={2} />
      </View>

      <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
        <ScheduleToggle value={scheduleType} onChange={handleScheduleChange} />

        {scheduleType === 'now' ? (
          // Soft info card — flat panel with subtle background, no
          // accent stripe.
          <View className="flex-row items-start bg-primaryLight rounded-xl p-4">
            <Info size={18} color="#2563EB" style={{ marginTop: 2 }} />
            <Text className="text-sm font-montserrat text-textPrimary ml-3 flex-1">
              Your errand will be matched to a runner immediately after booking.
            </Text>
          </View>
        ) : (
          <View>
            {/* Quick-pick chips — single-tap convenience for the most
                common scheduling intents. Tapping a chip seeds the wheel
                picker below so the user can fine-tune from there.
                Restyled: less rounded (12 vs 16), no shadow tile, the
                selected state uses a 2px brand border on a tinted bg
                instead of the previous "border + shadow + transparent"
                hack which read as nothing. */}
            {quickPicks.length > 0 && (
              <View className="mb-6">
                <View className="flex-row items-center mb-2">
                  <Zap size={12} color="#2563EB" strokeWidth={2} />
                  <Text className="text-[10px] font-montserrat-bold uppercase text-textSecondary ml-1.5" style={{ letterSpacing: 1.4 }}>
                    Quick pick
                  </Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingRight: 8 }}
                >
                  {quickPicks.map((pick, idx) => {
                    const iso = pick.value.toISOString();
                    const isSelected = selectedIso === iso;
                    return (
                      <Pressable
                        key={`${pick.label}-${idx}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${pick.label} ${pick.sublabel}`}
                        accessibilityState={{ selected: isSelected }}
                        onPress={() => updateDraft({ scheduled_at: iso })}
                        className="px-4 py-3 bg-surface"
                        style={{
                          minWidth: 110,
                          borderRadius: 12,
                          borderWidth: isSelected ? 2 : 1,
                          borderColor: isSelected ? '#2563EB' : '#E2E8F0',
                        }}
                      >
                        <Text
                          className={`text-[12px] font-montserrat-bold ${
                            isSelected ? 'text-primary' : 'text-textPrimary'
                          }`}
                        >
                          {pick.label}
                        </Text>
                        <Text
                          className="text-[11px] font-inter tabular-nums text-textSecondary mt-0.5"
                        >
                          {pick.sublabel}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            <DateTimePicker
              value={draftBooking.scheduled_at}
              onChange={(isoString) =>
                updateDraft({ scheduled_at: isoString })
              }
            />
          </View>
        )}

        <View className="h-24" />
      </ScrollView>

      {/* Bottom CTA */}
      <BottomActionBar>
        <Button
          title="Continue"
          onPress={handleContinue}
          disabled={
            scheduleType === 'scheduled' && !draftBooking.scheduled_at
          }
          fullWidth
        />
      </BottomActionBar>
    </View>
  );
}
