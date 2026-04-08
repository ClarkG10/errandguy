import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Info } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBookingStore } from '../../../stores/bookingStore';
import { Button } from '../../../components/ui/Button';
import { ScheduleToggle } from '../../../components/customer/ScheduleToggle';
import { DateTimePicker } from '../../../components/customer/DateTimePicker';
import type { ScheduleType } from '../../../types';

const STEP_LABELS = ['Type', 'Details', 'Schedule', 'Review'];

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

  const handleContinue = useCallback(() => {
    updateDraft({ schedule_type: scheduleType });
    setStep(3);
    router.push('/(customer)/book/review');
  }, [scheduleType, updateDraft, setStep, router]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-5 py-4">
        <Pressable onPress={() => router.back()} className="mr-3">
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-xl font-montserrat-bold text-textPrimary">
          Schedule
        </Text>
      </View>

      {/* Step Indicator */}
      <View className="flex-row px-5 mb-4">
        {STEP_LABELS.map((label, i) => (
          <View key={label} className="flex-1 items-center">
            <View
              className={`w-8 h-8 rounded-full items-center justify-center ${
                i <= 2 ? 'bg-primary' : 'bg-divider'
              }`}
            >
              <Text
                className={`text-xs font-montserrat-bold ${
                  i <= 2 ? 'text-white' : 'text-textSecondary'
                }`}
              >
                {i + 1}
              </Text>
            </View>
            <Text className="text-[10px] font-montserrat text-textSecondary mt-1">
              {label}
            </Text>
          </View>
        ))}
      </View>

      <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
        <ScheduleToggle value={scheduleType} onChange={handleScheduleChange} />

        {scheduleType === 'now' ? (
          <View className="flex-row items-start bg-primaryLight rounded-xl p-4">
            <Info size={18} color="#2563EB" style={{ marginTop: 2 }} />
            <Text className="text-sm font-montserrat text-primary ml-3 flex-1">
              Your errand will be matched to a runner immediately after booking.
            </Text>
          </View>
        ) : (
          <DateTimePicker
            value={draftBooking.scheduled_at}
            onChange={(isoString) =>
              updateDraft({ scheduled_at: isoString })
            }
          />
        )}

        <View className="h-24" />
      </ScrollView>

      {/* Bottom CTA */}
      <View className="absolute bottom-0 left-0 right-0 bg-background border-t border-divider px-5 py-4 pb-8">
        <Button
          title="Continue"
          onPress={handleContinue}
          disabled={
            scheduleType === 'scheduled' && !draftBooking.scheduled_at
          }
          fullWidth
        />
      </View>
    </SafeAreaView>
  );
}
