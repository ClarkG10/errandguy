import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import dayjs from 'dayjs';

interface DateTimePickerProps {
  value: string | undefined;
  onChange: (isoString: string) => void;
}

const TIME_SLOTS = Array.from({ length: 33 }, (_, i) => {
  const hour = 6 + Math.floor(i / 2);
  const minute = i % 2 === 0 ? '00' : '30';
  return `${String(hour).padStart(2, '0')}:${minute}`;
});

export function DateTimePicker({ value, onChange }: DateTimePickerProps) {
  const selectedDate = value ? dayjs(value) : null;

  const dates = useMemo(() => {
    const result: dayjs.Dayjs[] = [];
    for (let i = 1; i <= 7; i++) {
      result.push(dayjs().add(i, 'day'));
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
      <Text className="text-sm font-montserrat-bold text-textPrimary mb-2">
        Select Date
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mb-4"
        contentContainerStyle={{ gap: 10 }}
      >
        {dates.map((date) => {
          const isSelected =
            pickedDate && date.format('YYYY-MM-DD') === pickedDate.format('YYYY-MM-DD');
          return (
            <Pressable
              key={date.format('YYYY-MM-DD')}
              className={`px-4 py-3 rounded-xl border items-center min-w-[70px] ${
                isSelected
                  ? 'bg-primary border-primary'
                  : 'bg-surface border-divider'
              }`}
              onPress={() => handleDateSelect(date)}
            >
              <Text
                className={`text-[10px] font-montserrat ${
                  isSelected ? 'text-white/80' : 'text-textSecondary'
                }`}
              >
                {date.format('ddd')}
              </Text>
              <Text
                className={`text-lg font-montserrat-bold ${
                  isSelected ? 'text-white' : 'text-textPrimary'
                }`}
              >
                {date.format('D')}
              </Text>
              <Text
                className={`text-[10px] font-montserrat ${
                  isSelected ? 'text-white/80' : 'text-textSecondary'
                }`}
              >
                {date.format('MMM')}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Time Selection */}
      <Text className="text-sm font-montserrat-bold text-textPrimary mb-2">
        Select Time
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {TIME_SLOTS.map((time) => {
          const isSelected = pickedTime === time;
          return (
            <Pressable
              key={time}
              className={`px-3 py-2 rounded-lg border ${
                isSelected
                  ? 'bg-primary border-primary'
                  : 'bg-surface border-divider'
              }`}
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

      {/* Summary */}
      {pickedDate && pickedTime && (
        <View className="mt-4 p-3 bg-primaryLight rounded-xl">
          <Text className="text-sm font-montserrat text-primary text-center">
            Scheduled for{' '}
            <Text className="font-montserrat-bold">
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
