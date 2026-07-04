import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import dayjs from 'dayjs';
import { LightColors } from '../../constants/colors';

interface DateTimePickerProps {
  value: string | undefined;
  onChange: (isoString: string | undefined) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;

function WheelPicker({
  data,
  selected,
  onSelect,
  format,
}: {
  data: number[];
  selected: number;
  onSelect: (val: number) => void;
  format: (val: number) => string;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const initialIndex = data.indexOf(selected);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          y: initialIndex * ITEM_HEIGHT,
          animated: false,
        });
      }, 50);
    }
  }, [initialIndex]);

  const handleMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = e.nativeEvent.contentOffset.y;
      const index = Math.round(offsetY / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(index, data.length - 1));
      onSelect(data[clamped]);
    },
    [data, onSelect],
  );

  return (
    <View style={[ps.wheelContainer, { height: PICKER_HEIGHT }]}>
      <View style={ps.highlight} pointerEvents="none" />
      <ScrollView
        ref={scrollRef}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        contentContainerStyle={{
          paddingVertical: ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2),
        }}
        onMomentumScrollEnd={handleMomentumEnd}
      >
        {data.map((item) => {
          const isSelected = item === selected;
          return (
            <View key={item} style={ps.wheelItem}>
              <Text
                style={[
                  ps.wheelText,
                  isSelected && ps.wheelTextSelected,
                ]}
              >
                {format(item)}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function DateTimePicker({ value, onChange }: DateTimePickerProps) {
  const selectedDate = value ? dayjs(value) : null;

  // Show today + next 29 days. Today is allowed only if some time today is
  // still >30 minutes away from now (backend requires `after:+30 minutes`).
  const dates = useMemo(() => {
    const result: dayjs.Dayjs[] = [];
    const start = dayjs().add(31, 'minute').isAfter(dayjs().endOf('day')) ? 1 : 0;
    for (let i = start; i <= 29 + start; i++) {
      result.push(dayjs().add(i, 'day').startOf('day'));
    }
    return result;
  }, []);

  const [pickedDate, setPickedDate] = useState<dayjs.Dayjs | null>(
    selectedDate ? dayjs(selectedDate).startOf('day') : null,
  );
  const [pickedHour, setPickedHour] = useState<number>(
    selectedDate ? selectedDate.hour() : 9,
  );
  const [pickedMinute, setPickedMinute] = useState<number>(
    selectedDate ? selectedDate.minute() : 0,
  );

  const emitChange = useCallback(
    (date: dayjs.Dayjs | null, hour: number, minute: number) => {
      if (date) {
        const combined = date.hour(hour).minute(minute).second(0);
        // Backend requires scheduled_at > now + 30 minutes — guard at the
        // edge so an invalid combo never leaves the picker.
        if (combined.isBefore(dayjs().add(30, 'minute'))) {
          onChange(undefined);
          return;
        }
        onChange(combined.toISOString());
      }
    },
    [onChange],
  );

  const handleDateSelect = (date: dayjs.Dayjs) => {
    setPickedDate(date);
    emitChange(date, pickedHour, pickedMinute);
  };

  const handleHourSelect = (hour: number) => {
    setPickedHour(hour);
    emitChange(pickedDate, hour, pickedMinute);
  };

  const handleMinuteSelect = (minute: number) => {
    setPickedMinute(minute);
    emitChange(pickedDate, pickedHour, minute);
  };

  const formatDisplay = () => {
    if (!pickedDate) return null;
    const h = pickedHour % 12 || 12;
    const ampm = pickedHour >= 12 ? 'PM' : 'AM';
    const m = String(pickedMinute).padStart(2, '0');
    return `${pickedDate.format('MMMM D, YYYY')} at ${h}:${m} ${ampm}`;
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
                {date.isSame(dayjs(), 'day') ? 'Today' : date.format('ddd')}
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

      {/* Time Selection — Hour/Minute wheels */}
      <Text className="text-sm font-montserrat-semi text-textPrimary mb-2">
        Select Time
      </Text>
      <View style={ps.timeRow}>
        <WheelPicker
          data={HOURS}
          selected={pickedHour}
          onSelect={handleHourSelect}
          format={(h) => {
            const hr = h % 12 || 12;
            const ampm = h >= 12 ? 'PM' : 'AM';
            return `${hr} ${ampm}`;
          }}
        />
        <Text style={ps.separator}>:</Text>
        <WheelPicker
          data={MINUTES}
          selected={pickedMinute}
          onSelect={handleMinuteSelect}
          format={(m) => String(m).padStart(2, '0')}
        />
      </View>

      {/* Summary */}
      {pickedDate && (
        <View className="mt-4 p-3 bg-primaryLight rounded-xl">
          <Text className="text-sm font-montserrat text-primary text-center">
            Scheduled for{' '}
            <Text className="font-montserrat-semi">{formatDisplay()}</Text>
          </Text>
        </View>
      )}
    </View>
  );
}

const ps = StyleSheet.create({
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  separator: {
    fontSize: 22,
    fontFamily: 'Quicksand_600SemiBold',
    color: LightColors.textPrimary,
  },
  wheelContainer: {
    width: 100,
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: LightColors.surfaceMuted,
    borderWidth: 1,
    borderColor: LightColors.divider,
  },
  highlight: {
    position: 'absolute',
    top: ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2),
    left: 4,
    right: 4,
    height: ITEM_HEIGHT,
    backgroundColor: LightColors.primarySoft,
    borderRadius: 8,
    zIndex: 1,
  },
  wheelItem: {
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wheelText: {
    fontSize: 15,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textSecondary,
  },
  wheelTextSelected: {
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.primaryDark,
    fontSize: 17,
  },
});
