import React from 'react';
import { View, Text } from 'react-native';
import { Check, MapPin } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';
import type { BookingStop } from '../../types/booking';

/**
 * READ-ONLY customer mirror of the runner's extra-stop progress.
 *
 * A multi-stop errand costs the customer a real per-stop fee, and the runner
 * ticks each stop off in the cockpit (pushed here live as a
 * `booking_stops_updated` broadcast). Until this card existed those ticks
 * arrived on the device and rendered NOWHERE — the tracking screen never
 * showed the stops at all, so the customer's only way to ask "have you done
 * the Makati drop yet?" was chat.
 *
 * Same visual language as ShoppingProgressCard: checkbox + strike-through,
 * no press targets — the customer never owns the tick state.
 */
export interface StopsProgressCardProps {
  stops: BookingStop[] | null | undefined;
  /** Adds the "ticks land here live" reassurance line while the errand runs. */
  live?: boolean;
}

export function StopsProgressCard({ stops, live }: StopsProgressCardProps) {
  if (!stops?.length) return null;

  const ordered = [...stops].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const done = ordered.filter((s) => !!s.completed_at).length;

  return (
    <View
      className="bg-surface rounded-2xl border border-border p-4"
      accessibilityLabel={`Extra stops: ${done} of ${ordered.length} completed`}
    >
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center">
          <MapPin size={16} color={LightColors.primary} />
          <Text className="text-sm font-montserrat-semi text-text ml-2">Extra stops</Text>
        </View>
        <Text className="text-xs font-inter-semi tabular-nums text-textSecondary">
          {done}/{ordered.length} done
        </Text>
      </View>

      {ordered.map((stop) => {
        const isDone = !!stop.completed_at;
        return (
          <View key={stop.id} className="flex-row items-center py-1.5">
            <View
              className={`w-5 h-5 rounded-md items-center justify-center mr-3 ${
                isDone ? 'bg-success' : 'bg-surfaceMuted border border-border'
              }`}
            >
              {isDone && <Check size={13} color={LightColors.textInverse} strokeWidth={3} />}
            </View>
            <Text
              className={`flex-1 text-[13px] font-montserrat ${
                isDone ? 'text-textMuted line-through' : 'text-text'
              }`}
              numberOfLines={1}
            >
              {stop.address}
            </Text>
          </View>
        );
      })}

      {live && (
        <Text className="text-[11px] font-montserrat text-textMuted mt-1">
          Your runner ticks each stop off as they go — updates land here live.
        </Text>
      )}
    </View>
  );
}
