import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  type AccessibilityActionEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import dayjs from 'dayjs';
import { LightColors } from '../../constants/colors';

interface DateTimePickerProps {
  value: string | undefined;
  onChange: (isoString: string | undefined) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
// 5-minute steps — errands don't need minute precision, and 12 rows keep
// the wheel's scroll distance and SR tree small.
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;

/** Snap arbitrary (hydrated) minutes onto the 5-minute grid. */
function snapMinute(m: number) {
  return (Math.round(m / 5) * 5) % 60;
}

/**
 * First bookable slot ~1 hour out, rounded up to the 5-minute grid — so
 * "Today + defaults" always starts on a valid, submittable time.
 */
function nextSensibleSlot() {
  const base = dayjs().add(1, 'hour').second(0).millisecond(0);
  const m = Math.ceil(base.minute() / 5) * 5;
  return m === 60 ? base.add(1, 'hour').minute(0) : base.minute(m);
}

function WheelPicker({
  data,
  selected,
  onSelect,
  format,
  accessibilityLabel,
  isDimmed,
}: {
  data: number[];
  selected: number;
  onSelect: (val: number) => void;
  format: (val: number) => string;
  accessibilityLabel: string;
  /** Rows that can't produce a bookable time render muted. */
  isDimmed?: (val: number) => boolean;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const mounted = useRef(false);
  // Last index we ticked for — the selection haptic fires only when the
  // snapped value actually changes, so fast flicks don't buzz per-frame.
  const lastTickIndex = useRef(data.indexOf(selected));
  // Set while a programmatic scroll (chip seed / validity snap) is in
  // flight so the rows it passes don't each fire a haptic tick.
  const programmatic = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      const idx = data.indexOf(selected);
      // scrollTo before the ScrollView has laid out is a no-op; defer.
      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: idx * ITEM_HEIGHT, animated: false });
      }, 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow external `selected` changes (quick-pick seeds, validity snaps).
  useEffect(() => {
    const idx = data.indexOf(selected);
    if (idx >= 0 && idx !== lastTickIndex.current) {
      lastTickIndex.current = idx;
      programmatic.current = true;
      scrollRef.current?.scrollTo({ y: idx * ITEM_HEIGHT, animated: true });
    }
  }, [selected, data]);

  const handleMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      programmatic.current = false;
      const offsetY = e.nativeEvent.contentOffset.y;
      const index = Math.round(offsetY / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(index, data.length - 1));
      onSelect(data[clamped]);
    },
    [data, onSelect],
  );

  // Wheel tick — fires a selection haptic each time the wheel snaps past
  // a new value while scrolling (throttled by value change, not time).
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (programmatic.current) return;
      const index = Math.max(
        0,
        Math.min(
          Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT),
          data.length - 1,
        ),
      );
      if (index !== lastTickIndex.current) {
        lastTickIndex.current = index;
        Haptics.selectionAsync().catch(() => {});
      }
    },
    [data.length],
  );

  // Snap-scroll isn't SR-operable — expose the wheel as a single
  // adjustable control (swipe up/down to change), like a native
  // UIDatePicker column.
  const handleAccessibilityAction = useCallback(
    (e: AccessibilityActionEvent) => {
      const idx = data.indexOf(selected);
      const dir = e.nativeEvent.actionName === 'increment' ? 1 : -1;
      const next = Math.max(0, Math.min(idx + dir, data.length - 1));
      if (next === idx) return;
      onSelect(data[next]);
    },
    [data, selected, onSelect],
  );

  return (
    <View
      style={[ps.wheelContainer, { height: PICKER_HEIGHT }]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: format(selected) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={handleAccessibilityAction}
    >
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
        onScrollBeginDrag={() => {
          programmatic.current = false;
        }}
        onMomentumScrollEnd={handleMomentumEnd}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {data.map((item) => {
          const isSelected = item === selected;
          const dimmed = !isSelected && !!isDimmed?.(item);
          return (
            <View key={item} style={ps.wheelItem}>
              <Text
                style={[
                  ps.wheelText,
                  dimmed && ps.wheelTextDimmed,
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

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * Month-grid calendar — pick ANY date in the bookable window, not just the
 * next few days on the strip. Built on dayjs (no extra dependency) and styled
 * to match the app: selected day is a filled brand circle, today gets a ring,
 * out-of-window days are disabled. Month nav is bounded to [min, max].
 */
function MonthCalendar({
  selected,
  min,
  max,
  onSelect,
}: {
  selected: dayjs.Dayjs | null;
  min: dayjs.Dayjs;
  max: dayjs.Dayjs;
  onSelect: (d: dayjs.Dayjs) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => (selected ?? min).startOf('month'));
  const today = dayjs();

  const weeks = useMemo(() => {
    const first = viewMonth.startOf('month');
    const total = viewMonth.daysInMonth();
    const cells: (dayjs.Dayjs | null)[] = [];
    for (let i = 0; i < first.day(); i++) cells.push(null); // lead blanks
    for (let d = 1; d <= total; d++) cells.push(first.date(d));
    while (cells.length % 7 !== 0) cells.push(null); // trailing blanks
    const rows: (dayjs.Dayjs | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [viewMonth]);

  const canPrev = viewMonth.isAfter(min, 'month');
  const canNext = viewMonth.isBefore(max, 'month');

  return (
    <View style={ps.calendar}>
      <View style={ps.calHeader}>
        <Pressable
          disabled={!canPrev}
          hitSlop={8}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setViewMonth((m) => m.subtract(1, 'month'));
          }}
          style={[ps.calNav, !canPrev && ps.calNavDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
        >
          <ChevronLeft size={18} color={canPrev ? LightColors.primary : LightColors.textMuted} />
        </Pressable>
        <Text style={ps.calMonthLabel}>{viewMonth.format('MMMM YYYY')}</Text>
        <Pressable
          disabled={!canNext}
          hitSlop={8}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setViewMonth((m) => m.add(1, 'month'));
          }}
          style={[ps.calNav, !canNext && ps.calNavDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Next month"
        >
          <ChevronRight size={18} color={canNext ? LightColors.primary : LightColors.textMuted} />
        </Pressable>
      </View>

      <View style={ps.calWeekRow}>
        {WEEKDAY_LABELS.map((w, i) => (
          <Text key={i} style={ps.calWeekday}>
            {w}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={ps.calWeekRow}>
          {week.map((day, di) => {
            if (!day) return <View key={di} style={ps.calCell} />;
            const disabled = day.isBefore(min, 'day') || day.isAfter(max, 'day');
            const isSel = !!selected && day.isSame(selected, 'day');
            const isToday = day.isSame(today, 'day');
            return (
              <Pressable
                key={di}
                style={ps.calCell}
                disabled={disabled}
                onPress={() => onSelect(day.startOf('day'))}
                accessibilityRole="button"
                accessibilityState={{ selected: isSel, disabled }}
                accessibilityLabel={day.format('dddd, MMMM D')}
              >
                <View
                  style={[
                    ps.calDay,
                    isSel && ps.calDaySelected,
                    !isSel && isToday && ps.calDayToday,
                  ]}
                >
                  <Text
                    style={[
                      ps.calDayText,
                      isSel && ps.calDayTextSelected,
                      disabled && ps.calDayTextDisabled,
                    ]}
                  >
                    {day.date()}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// How far ahead scheduling is offered. The quick day-strip and the month
// calendar share this window so a date picked in either stays consistent.
// The server caps scheduled bookings at 30 days out (CreateBookingRequest:
// scheduled_at must be <= now+30d). Offering 90 here made 31-90-day-out dates
// look fully bookable, then hard-422'd at Confirm — a two-month dead-end in the
// funnel. Match the server window. (The review-step Confirm guard is the final
// safety net for the residual time-of-day edge on day 30.)
const BOOKABLE_DAYS = 30;

export function DateTimePicker({ value, onChange }: DateTimePickerProps) {
  // Today + the next ~90 days. Today is allowed only if some time today is
  // still >30 minutes away from now (backend requires `after:+30 minutes`).
  const dates = useMemo(() => {
    const result: dayjs.Dayjs[] = [];
    const start = dayjs().add(31, 'minute').isAfter(dayjs().endOf('day')) ? 1 : 0;
    for (let i = start; i < start + BOOKABLE_DAYS; i++) {
      result.push(dayjs().add(i, 'day').startOf('day'));
    }
    return result;
  }, []);

  // Bounds for the month calendar — the first and last selectable day.
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  const [calendarOpen, setCalendarOpen] = useState(false);

  const [defaultSlot] = useState(nextSensibleSlot);
  const initial = value ? dayjs(value) : null;

  const [pickedDate, setPickedDate] = useState<dayjs.Dayjs | null>(
    initial ? initial.startOf('day') : null,
  );
  const [pickedHour, setPickedHour] = useState<number>(
    initial ? initial.hour() : defaultSlot.hour(),
  );
  const [pickedMinute, setPickedMinute] = useState<number>(
    initial ? snapMinute(initial.minute()) : defaultSlot.minute(),
  );

  // Follow the value prop after mount (quick-pick chips write the draft
  // directly) — guarded against loops by comparing the combined local
  // selection before touching state.
  useEffect(() => {
    if (!value) return;
    const d = dayjs(value);
    const current = pickedDate
      ? pickedDate.hour(pickedHour).minute(pickedMinute).second(0).millisecond(0)
      : null;
    if (current && current.isSame(d, 'minute')) return;
    setPickedDate(d.startOf('day'));
    setPickedHour(d.hour());
    setPickedMinute(snapMinute(d.minute()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Keep the selected date chip visible when the selection changes from
  // outside the rail (hydrated draft, quick-pick seed).
  const dateScrollRef = useRef<ScrollView>(null);
  const dateOffsets = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!pickedDate) return;
    const key = pickedDate.format('YYYY-MM-DD');
    const timer = setTimeout(() => {
      const x = dateOffsets.current[key];
      if (x != null) {
        dateScrollRef.current?.scrollTo({ x: Math.max(0, x - 24), animated: true });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [pickedDate]);

  /**
   * Nearest-forward bookable (hour, minute) when the candidate combo is
   * inside the 30-minute lead window — prevention beats an error card.
   * Returns null when the combo is already valid (or can't be rescued).
   */
  const snapForward = (date: dayjs.Dayjs, hour: number, minute: number) => {
    const min = dayjs().add(30, 'minute');
    const combined = date.hour(hour).minute(minute).second(0).millisecond(0);
    if (!combined.isBefore(min)) return null;
    if (!date.isSame(min, 'day')) return null;
    const m = Math.ceil(min.minute() / 5) * 5;
    const slot = m === 60 ? min.add(1, 'hour').minute(0) : min.minute(m);
    if (!slot.isSame(date, 'day')) return null;
    return { hour: slot.hour(), minute: slot.minute() };
  };

  const emitChange = useCallback(
    (date: dayjs.Dayjs | null, hour: number, minute: number) => {
      if (!date) return;
      const combined = date.hour(hour).minute(minute).second(0).millisecond(0);
      // Backend requires scheduled_at > now + 30 minutes. Invalid combos
      // are never committed — and never clear a previously valid draft
      // value; the inline error below the wheels explains the state.
      if (combined.isBefore(dayjs().add(30, 'minute'))) return;
      onChange(combined.toISOString());
    },
    [onChange],
  );

  const handleDateSelect = (date: dayjs.Dayjs) => {
    Haptics.selectionAsync().catch(() => {});
    const snap = snapForward(date, pickedHour, pickedMinute);
    setPickedDate(date);
    if (snap) {
      setPickedHour(snap.hour);
      setPickedMinute(snap.minute);
      emitChange(date, snap.hour, snap.minute);
    } else {
      emitChange(date, pickedHour, pickedMinute);
    }
  };

  const handleHourSelect = (hour: number) => {
    const snap = pickedDate ? snapForward(pickedDate, hour, pickedMinute) : null;
    if (snap) {
      setPickedHour(snap.hour);
      setPickedMinute(snap.minute);
      emitChange(pickedDate, snap.hour, snap.minute);
    } else {
      setPickedHour(hour);
      emitChange(pickedDate, hour, pickedMinute);
    }
  };

  const handleMinuteSelect = (minute: number) => {
    const snap = pickedDate ? snapForward(pickedDate, pickedHour, minute) : null;
    if (snap) {
      setPickedHour(snap.hour);
      setPickedMinute(snap.minute);
      emitChange(pickedDate, snap.hour, snap.minute);
    } else {
      setPickedMinute(minute);
      emitChange(pickedDate, pickedHour, minute);
    }
  };

  const minBookable = dayjs().add(30, 'minute');
  const isToday = pickedDate ? pickedDate.isSame(dayjs(), 'day') : false;
  const combinedLocal = pickedDate
    ? pickedDate.hour(pickedHour).minute(pickedMinute).second(0).millisecond(0)
    : null;
  const tooSoon = !!combinedLocal && combinedLocal.isBefore(minBookable);

  return (
    <View>
      {/* Date Selection — label + a "Calendar" toggle that opens a full
          month grid for picking any date in the window (the quick day-strip
          below stays for fast one-tap picks of the next few days). */}
      <View className="flex-row items-center justify-between mb-2">
        <Text
          className="text-[10px] font-montserrat-bold uppercase text-textSecondary"
          style={{ letterSpacing: 1.4 }}
        >
          Select date
        </Text>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setCalendarOpen((o) => !o);
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={calendarOpen ? 'Close calendar' : 'Open calendar'}
          accessibilityState={{ expanded: calendarOpen }}
          className="flex-row items-center px-2.5 py-1.5 rounded-lg bg-surfaceMuted"
        >
          {calendarOpen ? (
            <X size={13} color={LightColors.primary} strokeWidth={2.4} />
          ) : (
            <CalendarDays size={13} color={LightColors.primary} strokeWidth={2.2} />
          )}
          <Text className="text-[11px] font-montserrat-semi text-primary ml-1.5">
            {calendarOpen ? 'Close' : 'Calendar'}
          </Text>
        </Pressable>
      </View>

      {calendarOpen && (
        <MonthCalendar
          selected={pickedDate}
          min={minDate}
          max={maxDate}
          onSelect={(d) => {
            handleDateSelect(d);
            setCalendarOpen(false);
          }}
        />
      )}

      {/* Bleeds past the host screen's px-5 gutter (schedule.tsx) so
          scrolled chips run to the true screen edge instead of clipping
          at the padding line; inner padding restores the alignment. */}
      <ScrollView
        ref={dateScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        className="-mx-5 mb-5"
        contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
      >
        {dates.map((date) => {
          const key = date.format('YYYY-MM-DD');
          const isSelected = !!pickedDate && key === pickedDate.format('YYYY-MM-DD');
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={
                date.isSame(dayjs(), 'day')
                  ? `Today, ${date.format('MMMM D')}`
                  : date.format('dddd, MMMM D')
              }
              accessibilityState={{ selected: isSelected }}
              className="px-3 py-2.5 rounded-xl items-center min-w-[60px]"
              // Selection = soft tint + brand border, DARK text in both
              // states (never inverted to invisible white). Constant border
              // width so the chip's content never shifts and the rail
              // doesn't reflow.
              style={({ pressed }) => [
                {
                  borderWidth: 1.5,
                  borderColor: isSelected ? LightColors.primary : LightColors.divider,
                  backgroundColor: isSelected ? LightColors.primaryLight : LightColors.surface,
                },
                pressed && { opacity: 0.85 },
              ]}
              android_ripple={{ color: `${LightColors.primary}14` }}
              onLayout={(e) => {
                dateOffsets.current[key] = e.nativeEvent.layout.x;
              }}
              onPress={() => handleDateSelect(date)}
            >
              <Text
                className="text-[10px] font-montserrat"
                style={{ color: LightColors.textTertiary }}
              >
                {date.isSame(dayjs(), 'day') ? 'Today' : date.format('ddd')}
              </Text>
              <Text
                className="text-base font-montserrat-semi"
                style={{
                  color: isSelected ? LightColors.primaryDark : LightColors.textPrimary,
                }}
              >
                {date.format('D')}
              </Text>
              <Text
                className="text-[10px] font-montserrat"
                style={{ color: LightColors.textTertiary }}
              >
                {date.format('MMM')}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Time Selection — Hour/Minute wheels */}
      <Text
        className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-2"
        style={{ letterSpacing: 1.4 }}
      >
        Select time
      </Text>
      <View style={ps.timeRow}>
        <WheelPicker
          data={HOURS}
          selected={pickedHour}
          onSelect={handleHourSelect}
          accessibilityLabel="Hour"
          isDimmed={
            isToday && pickedDate
              ? (h) => pickedDate.hour(h).minute(55).isBefore(minBookable)
              : undefined
          }
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
          accessibilityLabel="Minute"
          isDimmed={
            isToday && pickedDate
              ? (m) => pickedDate.hour(pickedHour).minute(m).isBefore(minBookable)
              : undefined
          }
          format={(m) => String(m).padStart(2, '0')}
        />
      </View>

      {/* Readback — confident blue card only for a committed valid value;
          a too-soon local selection gets the danger card instead. */}
      {tooSoon ? (
        <View
          className="mt-4 p-3 bg-dangerSoft rounded-xl flex-row items-start"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <AlertCircle size={16} color={LightColors.dangerDark} style={{ marginTop: 2 }} />
          <Text className="text-sm font-montserrat-semi text-dangerDark ml-2 flex-1">
            That time has passed — pick a time at least 30 minutes from now.
          </Text>
        </View>
      ) : value ? (
        <View className="mt-4 p-3 bg-primaryLight rounded-xl">
          <Text className="text-sm font-montserrat text-primary text-center">
            Scheduled for{' '}
            <Text className="font-montserrat-semi">
              {dayjs(value).format('MMMM D, YYYY [at] h:mm A')}
            </Text>
          </Text>
        </View>
      ) : null}
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
  // Declared before the ScrollView (and with no zIndex) so the opaque
  // band paints UNDER the row text — with a zIndex it would sit on top
  // and hide the selected value entirely.
  highlight: {
    position: 'absolute',
    top: ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2),
    left: 4,
    right: 4,
    height: ITEM_HEIGHT,
    backgroundColor: LightColors.primarySoft,
    borderRadius: 8,
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
  wheelTextDimmed: {
    color: LightColors.textMuted,
  },
  wheelTextSelected: {
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.primaryDark,
    fontSize: 17,
  },
  // ── Month calendar ──
  calendar: {
    borderWidth: 1,
    borderColor: LightColors.divider,
    borderRadius: 16,
    padding: 12,
    marginBottom: 16,
    backgroundColor: LightColors.surface,
  },
  calHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  calNav: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LightColors.surfaceMuted,
  },
  calNavDisabled: {
    backgroundColor: LightColors.surfaceMuted,
  },
  calMonthLabel: {
    fontSize: 15,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textPrimary,
  },
  calWeekRow: {
    flexDirection: 'row',
  },
  calWeekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textTertiary,
    paddingVertical: 6,
  },
  calCell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calDay: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calDaySelected: {
    backgroundColor: LightColors.primary,
  },
  calDayToday: {
    borderWidth: 1.5,
    borderColor: LightColors.primary200,
  },
  calDayText: {
    fontSize: 14,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textPrimary,
  },
  calDayTextSelected: {
    color: LightColors.textInverse,
    fontFamily: 'Quicksand_700Bold',
  },
  calDayTextDisabled: {
    color: LightColors.textMuted,
    opacity: 0.4,
  },
});
