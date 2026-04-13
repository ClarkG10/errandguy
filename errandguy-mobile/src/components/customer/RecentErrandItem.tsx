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
      className="flex-row items-center bg-surface rounded-2xl p-4 mb-2.5"
      style={{ shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 }}
      onPress={onPress}
    >
      <View className="w-10 h-10 rounded-xl bg-primary50 items-center justify-center mr-3">
        <Package size={18} color="#2563EB" />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-montserrat-bold text-textPrimary" numberOfLines={1}>
          {booking.errand_type?.name ?? 'Errand'}
        </Text>
        <Text className="text-[11px] font-montserrat text-textTertiary mt-0.5">
          {formatRelativeTime(booking.created_at)}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-sm font-montserrat-bold text-textPrimary">
          {formatCurrency(booking.total_amount)}
        </Text>
        <View
          className="px-2 py-0.5 rounded-full mt-1"
          style={{ backgroundColor: statusColor + '15' }}
        >
          <Text
            className="text-[10px] font-montserrat-semi"
            style={{ color: statusColor }}
          >
            {statusLabel}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});
