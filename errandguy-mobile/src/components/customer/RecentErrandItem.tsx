import React, { memo } from 'react';
import { View, Text } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Card } from '../ui/Card';
import { ErrandTypeIcon } from '../ui/ErrandTypeIcon';
import { statusLabel, STATUS_COLORS } from '../../constants/statusLabels';
import { LightColors } from '../../constants/colors';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatRelativeTime } from '../../utils/formatDate';
import type { Booking } from '../../types';

interface RecentErrandItemProps {
  booking: Booking;
  // Receives the row's booking so callers can pass a STABLE handler (e.g. a
  // useCallback) — an inline `() => onPress(item)` at the call site would
  // allocate a fresh function per row and defeat this component's React.memo.
  onPress: (booking: Booking) => void;
}

/**
 * Recent-errand card.
 *
 * White Card with the rich SVG `ErrandTypeIcon` (tinted variant) in the
 * header row, a pickup → drop-off timeline (bead + dashed connector +
 * square bead) underneath, and the date/price in Inter for numeric
 * crispness — matching the ride-history cards in the reference designs.
 */
export const RecentErrandItem = memo(function RecentErrandItem({
  booking,
  onPress,
}: RecentErrandItemProps) {
  const statusColor = STATUS_COLORS[booking.status] ?? LightColors.textMuted;
  // Type-aware: "Picked Up" on a bills-payment or queue errand described a
  // parcel that never existed. Same label the tracking screen and the push
  // for this errand use.
  const label = statusLabel(booking.status, booking.errand_type?.slug);
  // Map the API icon (Lucide name string) onto our SVG illustration
  // catalogue. Falls back gracefully to Package inside ErrandTypeIcon.
  const iconName = booking.errand_type?.icon_name ?? null;

  return (
    <Card
      onPress={() => onPress(booking)}
      padding="sm"
      className="mb-2.5"
      accessibilityLabel={`${
        booking.errand_type?.name ?? 'Errand'
      }, ${label}, ${formatCurrency(booking.total_amount)}`}
    >
      {/* Header row — type icon, name + status, price + chevron. */}
      <View className="flex-row items-center">
        <ErrandTypeIcon name={iconName} size="sm" variant="tinted" />
        <View className="flex-1 ml-3">
          <Text
            className="text-sm font-montserrat-semi text-textPrimary"
            numberOfLines={1}
          >
            {booking.errand_type?.name ?? 'Errand'}
          </Text>
          <View className="flex-row items-center mt-0.5">
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: 2.5,
                backgroundColor: statusColor,
                marginRight: 6,
              }}
            />
            <Text
              className="text-[11px] font-inter-semi text-textTertiary"
              numberOfLines={1}
            >
              {label} · {formatRelativeTime(booking.created_at)}
            </Text>
          </View>
        </View>
        <View className="items-end ml-2">
          <Text className="text-sm font-inter-semi text-textPrimary">
            {formatCurrency(booking.total_amount)}
          </Text>
          <ChevronRight
            size={16}
            color={LightColors.textMuted}
            strokeWidth={2}
            style={{ marginTop: 2 }}
          />
        </View>
      </View>

      {/* Route timeline — pickup bead, hairline connector, drop-off
          square. Only rendered when the booking carries addresses. */}
      {booking.pickup_address || booking.dropoff_address ? (
        <View className="mt-3 pt-3 border-t border-divider">
          {booking.pickup_address ? (
            <View className="flex-row items-center">
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 3.5,
                  backgroundColor: LightColors.success,
                }}
              />
              <Text
                className="flex-1 ml-2.5 text-[11px] font-montserrat text-textSecondary"
                numberOfLines={1}
              >
                {booking.pickup_address}
              </Text>
            </View>
          ) : null}
          {booking.pickup_address && booking.dropoff_address ? (
            <View
              style={{
                marginLeft: 3,
                width: 1.5,
                height: 10,
                backgroundColor: LightColors.divider,
                marginVertical: 3,
              }}
            />
          ) : null}
          {booking.dropoff_address ? (
            <View className="flex-row items-center">
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 2,
                  backgroundColor: LightColors.textPrimary,
                }}
              />
              <Text
                className="flex-1 ml-2.5 text-[11px] font-montserrat text-textSecondary"
                numberOfLines={1}
              >
                {booking.dropoff_address}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
});
