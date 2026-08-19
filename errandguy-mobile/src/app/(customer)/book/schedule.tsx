import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, AppState } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Info, Zap } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import dayjs from 'dayjs';
import { useBookingStore } from '../../../stores/bookingStore';
import { toast } from '../../../stores/toastStore';
import { Button } from '../../../components/ui/Button';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { ScheduleToggle } from '../../../components/customer/ScheduleToggle';
import { DateTimePicker } from '../../../components/customer/DateTimePicker';
import { BookingStepIndicator } from '../../../components/customer/BookingStepIndicator';
import { LightColors } from '../../../constants/colors';
import { useResponsive } from '../../../constants/responsive';
import type { ScheduleType } from '../../../types';

// Legacy local labels kept only as documentation of the canonical order.
// All step UI is now driven by `BookingStepIndicator`.

/**
 * Convenience presets shown above the wheel picker. The labels are
 * resolved each render so "Tonight 7 PM" doesn't suggest a time that's
 * already past on the device clock — past presets are filtered out.
 */
function buildQuickPicks(raw: dayjs.Dayjs) {
  const picks: { label: string; value: dayjs.Dayjs; sublabel: string }[] = [];
  // Zero sub-minute noise so a pick's ISO round-trips identically through
  // the wheel picker (which emits whole minutes).
  const now = raw.millisecond(0);

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
  // Self-resetting guard so a fast double-tap on Continue can't push review
  // twice (router.push is non-idempotent; the CTA stays mounted mid-push).
  const navLatch = useRef(false);
  const insets = useSafeAreaInsets();
  const { contentMaxWidth } = useResponsive();
  const { draftBooking, updateDraft, setStep } = useBookingStore();

  const [scheduleType, setScheduleType] = useState<ScheduleType>(
    draftBooking.schedule_type ?? 'now',
  );

  // Quick presets capture the device clock, so they're re-anchored
  // whenever it may have drifted: on foreground return and when the
  // picker section becomes visible again.
  const [picksNow, setPicksNow] = useState(() => dayjs());
  const quickPicks = useMemo(() => buildQuickPicks(picksNow), [picksNow]);
  const selectedIso = draftBooking.scheduled_at;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setPicksNow(dayjs());
    });
    return () => sub.remove();
  }, []);

  // A persisted draft can rehydrate with a scheduled_at that has since
  // passed the backend's 30-minute lead window — drop it here rather
  // than let it surface a confident readback and fail two steps later.
  useEffect(() => {
    const at = draftBooking.scheduled_at;
    if (at && dayjs(at).isBefore(dayjs().add(30, 'minute'))) {
      updateDraft({ scheduled_at: undefined });
      if (draftBooking.schedule_type === 'scheduled') {
        toast.info('Your scheduled time has passed — pick a new one.');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScheduleChange = useCallback(
    (type: ScheduleType) => {
      setScheduleType(type);
      // scheduled_at stays in the draft while on "Now" (it's inert
      // there) so an accidental toggle round-trip doesn't destroy the
      // picked time; it's stripped at Continue instead.
      updateDraft({ schedule_type: type });
      if (type === 'scheduled') setPicksNow(dayjs());
    },
    [updateDraft],
  );

  const handleContinue = useCallback(() => {
    if (scheduleType === 'scheduled') {
      const at = draftBooking.scheduled_at;
      // Presence is gated by the button, but time may have passed since
      // the value was picked — never forward a sub-30-minute time.
      if (!at || dayjs(at).isBefore(dayjs().add(30, 'minute'))) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        toast.error('Your scheduled time has passed — pick a new one.');
        updateDraft({ scheduled_at: undefined });
        return;
      }
    }
    updateDraft({
      schedule_type: scheduleType,
      scheduled_at:
        scheduleType === 'now' ? undefined : draftBooking.scheduled_at,
    });
    setStep(3);
    if (navLatch.current) return;
    navLatch.current = true;
    router.push('/(customer)/book/review');
    setTimeout(() => {
      navLatch.current = false;
    }, 700);
  }, [scheduleType, draftBooking.scheduled_at, updateDraft, setStep, router]);

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="When?" showBack fallbackHref="/(customer)/(tabs)">
        <View className="px-5 -mt-2 pb-3">
          <Text
            className="text-[10px] font-montserrat-bold uppercase"
            style={{ letterSpacing: 1.4, color: LightColors.textSecondary }}
          >
            New errand · Step 3
          </Text>
        </View>
      </GradientHeader>

      {/* Step indicator — clamped to the same content column as the
          body so tablet edges align (mirrors type.tsx). */}
      <View className="px-5 mt-3 mb-3">
        <View style={{ maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}>
          <BookingStepIndicator currentStep={2} />
        </View>
      </View>

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          maxWidth: contentMaxWidth,
          width: '100%',
          alignSelf: 'center',
          // Clearance for the sticky BottomActionBar (16 top pad +
          // ~48-51 button + max(inset, 12) bottom pad) — a fixed spacer
          // under-shoots on notch iPhones (34pt inset) and 3-button
          // Android (48dp), hiding the readback/error card behind the bar.
          paddingBottom: Math.max(insets.bottom, 12) + 96,
        }}
      >
        <ScheduleToggle value={scheduleType} onChange={handleScheduleChange} />

        {scheduleType === 'now' ? (
          // Soft info card — flat panel with subtle background, no
          // accent stripe.
          <View className="flex-row items-start bg-divider rounded-xl p-4">
            <Info size={18} color={LightColors.primary} style={{ marginTop: 2 }} />
            <Text className="text-sm font-montserrat text-textPrimary ml-3 flex-1">
              Your errand will be matched to a runner immediately after booking.
            </Text>
          </View>
        ) : (
          <View>
            {/* Quick-pick chips — single-tap convenience for the most
                common scheduling intents. A tap writes the draft value,
                which the wheel picker below follows (date rail + wheels
                seed from it) so the user can fine-tune from there.
                Validity is re-checked at tap time because picks capture
                the clock at build time. */}
            {quickPicks.length > 0 && (
              <View className="mb-6">
                <View className="flex-row items-center mb-2">
                  <Zap size={12} color={LightColors.primary} strokeWidth={2} />
                  <Text className="text-[10px] font-montserrat-bold uppercase text-textSecondary ml-1.5" style={{ letterSpacing: 1.4 }}>
                    Quick pick
                  </Text>
                </View>
                {/* Bleed past the screen's px-5 gutter so scrolled chips
                    run to the true screen edge instead of clipping at the
                    padding line; inner padding restores the alignment. */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  className="-mx-5"
                  contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
                >
                  {quickPicks.map((pick, idx) => {
                    const iso = pick.value.toISOString();
                    // Minute-level match so the highlight survives the
                    // draft value round-tripping through the wheels.
                    const isSelected =
                      !!selectedIso && dayjs(selectedIso).isSame(pick.value, 'minute');
                    return (
                      <Pressable
                        key={`${pick.label}-${idx}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${pick.label} ${pick.sublabel}`}
                        accessibilityState={{ selected: isSelected }}
                        onPress={() => {
                          // Picks capture the clock — a chip can go stale
                          // while the app is open. Rebuild instead of
                          // writing an unbookable time into the draft.
                          if (pick.value.isBefore(dayjs().add(30, 'minute'))) {
                            Haptics.notificationAsync(
                              Haptics.NotificationFeedbackType.Warning,
                            ).catch(() => {});
                            setPicksNow(dayjs());
                            return;
                          }
                          Haptics.selectionAsync().catch(() => {});
                          updateDraft({ scheduled_at: iso });
                        }}
                        className="px-4 py-3"
                        // Selection = soft tint + brand border with DARK text
                        // in both states (matches the date-rail chips below,
                        // so the two rails read as one control family — and
                        // never inverts text to invisible white). Constant
                        // border width so the row never reflows.
                        style={({ pressed }) => [
                          {
                            minWidth: 110,
                            borderRadius: 12,
                            borderWidth: 1.5,
                            borderColor: isSelected
                              ? LightColors.primary
                              : LightColors.divider,
                            backgroundColor: isSelected
                              ? LightColors.primaryLight
                              : LightColors.surface,
                          },
                          pressed && { opacity: 0.85 },
                        ]}
                        android_ripple={{ color: `${LightColors.primary}14` }}
                      >
                        <Text
                          className="text-[12px] font-montserrat-bold"
                          style={{
                            color: isSelected
                              ? LightColors.primaryDark
                              : LightColors.textPrimary,
                          }}
                        >
                          {pick.label}
                        </Text>
                        <Text
                          className="text-[11px] font-inter tabular-nums mt-0.5"
                          style={{ color: LightColors.textSecondary }}
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

      </ScrollView>

      {/* Bottom CTA — clamped to the content column on tablets. */}
      <BottomActionBar>
        <View style={{ maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}>
          <Button
            title="Continue"
            onPress={handleContinue}
            disabled={
              scheduleType === 'scheduled' && !draftBooking.scheduled_at
            }
            fullWidth
          />
        </View>
      </BottomActionBar>
    </View>
  );
}
