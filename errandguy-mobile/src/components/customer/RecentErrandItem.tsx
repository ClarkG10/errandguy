import React, { memo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Package, ChevronRight } from 'lucide-react-native';
import { STATUS_LABELS, STATUS_COLORS } from '../../constants/statusLabels';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatRelativeTime } from '../../utils/formatDate';
import type { Booking } from '../../types';

interface RecentErrandItemProps {
  booking: Booking;
  onPress: () => void;
}

export const RecentErrandItem = memo(function RecentErrandItem({ booking, onPress }: RecentErrandItemProps) {
  const statusColor = STATUS_COLORS[booking.status] ?? '#94A3B8';
  const statusLabel = STATUS_LABELS[booking.status] ?? booking.status;

  return (
    <Pressable
      className="flex-row items-center bg-surface border border-divider rounded-xl p-3 mb-2"
      onPress={onPress}
    >
      <View className="w-10 h-10 rounded-lg bg-primaryLight items-center justify-center mr-3">
        <Package size={20} color="#2563EB" />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-montserrat-bold text-textPrimary" numberOfLines={1}>
          {booking.errand_type?.name ?? 'Errand'}
        </Text>
        <Text className="text-xs font-montserrat text-textSecondary mt-0.5">
          {formatRelativeTime(booking.created_at)}
        </Text>
      </View>
      <View className="items-end mr-2">
        <Text className="text-sm font-montserrat-bold text-textPrimary">
          {formatCurrency(booking.total_amount)}
        </Text>
        <View
          className="px-1.5 py-0.5 rounded mt-0.5"
          style={{ backgroundColor: statusColor + '20' }}
        >
          <Text
            className="text-[10px] font-montserrat-bold"
            style={{ color: statusColor }}
          >
            {statusLabel}
          </Text>
        </View>
      </View>
      <ChevronRight size={16} color="#94A3B8" />
    </Pressable>
  );
});
