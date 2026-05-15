import React, { memo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { ErrandTypeIcon } from '../ui/ErrandTypeIcon';
import { STATUS_LABELS, STATUS_COLORS } from '../../constants/statusLabels';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatRelativeTime } from '../../utils/formatDate';
import type { Booking } from '../../types';

interface RecentErrandItemProps {
  booking: Booking;
  onPress: () => void;
}

/**
 * Recent-errand row.
 *
 * Renders the rich SVG `ErrandTypeIcon` (tinted variant) so each row
 * is instantly identifiable at a glance — the previous flat Lucide
 * `Package` was used for every booking regardless of type, which made
 * the list visually monotone.
 */
export const RecentErrandItem = memo(function RecentErrandItem({
  booking,
  onPress,
}: RecentErrandItemProps) {
  const statusColor = STATUS_COLORS[booking.status] ?? '#94A3B8';
  const statusLabel = STATUS_LABELS[booking.status] ?? booking.status;
  // Map the API icon (Lucide name string) onto our SVG illustration
  // catalogue. Falls back gracefully to Package inside ErrandTypeIcon.
  const iconName = booking.errand_type?.icon_name ?? null;

  return (
    <Pressable
      className="flex-row items-center bg-surface rounded-2xl p-3.5 mb-2.5"
      style={({ pressed }) => [
        {
          shadowColor: '#0F172A',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.04,
          shadowRadius: 8,
          elevation: 1,
        },
        pressed && { opacity: 0.92 },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${
        booking.errand_type?.name ?? 'Errand'
      }, ${statusLabel}, ${formatCurrency(booking.total_amount)}`}
    >
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
            className="text-[11px] font-montserrat text-textTertiary"
            numberOfLines={1}
          >
            {statusLabel} · {formatRelativeTime(booking.created_at)}
          </Text>
        </View>
      </View>
      <View className="items-end ml-2">
        <Text className="text-sm font-inter-semi text-textPrimary">
          {formatCurrency(booking.total_amount)}
        </Text>
        <ChevronRight
          size={16}
          color="#CBD5E1"
          strokeWidth={2}
          style={{ marginTop: 2 }}
        />
      </View>
    </Pressable>
  );
});
