import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import dayjs from 'dayjs';

interface DateTimePickerProps {
  value: string | undefined;
  onChange: (isoString: string) => void;
}

// 30-min intervals from 6:00 AM to 10:00 PM
const TIME_SLOTS = Array.from({ length: 33 }, (_, i) => {
  const hour = 6 + Math.floor(i / 2);
  const minute = i % 2 === 0 ? '00' : '30';
  return `${String(hour).padStart(2, '0')}:${minute}`;
});

export function DateTimePicker({ value, onChange }: DateTimePickerProps) {
  const selectedDate = value ? dayjs(value) : null;

  // Show 14 days ahead for more flexibility
  const dates = useMemo(() => {
    const result: dayjs.Dayjs[] = [];
    for (let i = 0; i <= 13; i++) {
      result.push(dayjs().add(i + 1, 'day'));
    }
    return result;
  }, []);

  const [pickedDate, setPickedDate] = useState<dayjs.Dayjs | null>(
    selectedDate ? dayjs(selectedDate).startOf('day') : null,
  );
  const [pickedTime, setPickedTime] = useState<string | null>(
    selectedDate ? selectedDate.format('HH:mm') : null,
  );

  const handleDateSelect = (date: dayjs.Dayjs) => {
    setPickedDate(date);
    if (pickedTime) {
      const [h, m] = pickedTime.split(':');
      const combined = date.hour(parseInt(h, 10)).minute(parseInt(m, 10));
      onChange(combined.toISOString());
    }
  };

  const handleTimeSelect = (time: string) => {
    setPickedTime(time);
    if (pickedDate) {
      const [h, m] = time.split(':');
      const combined = pickedDate
        .hour(parseInt(h, 10))
        .minute(parseInt(m, 10));
      onChange(combined.toISOString());
    }
  };

  return (
    <View>
      {/* Date Selection */}
      <Text className="text-sm font-montserrat-semi text-textPrimary mb-2">
        Select Date
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mb-5"
        contentContainerStyle={{ gap: 8 }}
      >
        {dates.map((date) => {
          const isSelected =
            pickedDate && date.format('YYYY-MM-DD') === pickedDate.format('YYYY-MM-DD');
          return (
            <Pressable
              key={date.format('YYYY-MM-DD')}
              className={`px-3 py-2.5 rounded-xl items-center min-w-[60px] ${
                isSelected
                  ? 'bg-primary'
                  : 'bg-surface border border-divider'
              }`}
              onPress={() => handleDateSelect(date)}
            >
              <Text
                className={`text-[10px] font-montserrat ${
                  isSelected ? 'text-white/70' : 'text-textTertiary'
                }`}
              >
                {date.format('ddd')}
              </Text>
              <Text
                className={`text-base font-montserrat-semi ${
                  isSelected ? 'text-white' : 'text-textPrimary'
                }`}
              >
                {date.format('D')}
              </Text>
              <Text
                className={`text-[10px] font-montserrat ${
                  isSelected ? 'text-white/70' : 'text-textTertiary'
                }`}
              >
                {date.format('MMM')}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Time Selection */}
      <Text className="text-sm font-montserrat-semi text-textPrimary mb-2">
        Select Time
      </Text>
      <ScrollView style={{ maxHeight: 240 }} showsVerticalScrollIndicator={false}>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {TIME_SLOTS.map((time) => {
            const isSelected = pickedTime === time;
            return (
              <Pressable
                key={time}
                className={`rounded-lg items-center justify-center ${
                  isSelected
                    ? 'bg-primary'
                    : 'bg-surface border border-divider'
                }`}
                style={{ paddingHorizontal: 12, paddingVertical: 8, minWidth: 76 }}
                onPress={() => handleTimeSelect(time)}
              >
                <Text
                  className={`text-xs font-montserrat ${
                    isSelected ? 'text-white' : 'text-textPrimary'
                  }`}
                >
                  {dayjs().hour(parseInt(time.split(':')[0], 10)).minute(parseInt(time.split(':')[1], 10)).format('h:mm A')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Summary */}
      {pickedDate && pickedTime && (
        <View className="mt-4 p-3 bg-primaryLight rounded-xl">
          <Text className="text-sm font-montserrat text-primary text-center">
            Scheduled for{' '}
            <Text className="font-montserrat-semi">
              {pickedDate.format('MMMM D, YYYY')} at{' '}
              {dayjs()
                .hour(parseInt(pickedTime.split(':')[0], 10))
                .minute(parseInt(pickedTime.split(':')[1], 10))
                .format('h:mm A')}
            </Text>
          </Text>
        </View>
      )}
    </View>
  );
}
