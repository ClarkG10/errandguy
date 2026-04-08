import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { MapPin, ArrowRight, RefreshCw, Calendar } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { PriceBreakdown } from '../ui/PriceBreakdown';
import { StatusTimeline } from '../ui/StatusTimeline';
import { Avatar } from '../ui/Avatar';
import { RatingStars } from '../ui/RatingStars';
import { Badge } from '../ui/Badge';
import { bookingService } from '../../services/booking.service';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatFullDate, formatTime } from '../../utils/formatDate';
import { STATUS_LABELS, STATUS_COLORS } from '../../constants/statusLabels';
import type { Booking, BookingStatusLog } from '../../types';

interface BookingDetailSheetProps {
  booking: Booking | null;
  isVisible: boolean;
  onClose: () => void;
}

export function BookingDetailSheet({
  booking,
  isVisible,
  onClose,
}: BookingDetailSheetProps) {
  const router = useRouter();
  const [rebooking, setRebooking] = useState(false);

  if (!booking) return null;

  const statusColor = STATUS_COLORS[booking.status] ?? '#94A3B8';
  const statusLabel = STATUS_LABELS[booking.status] ?? booking.status;

  const priceItems = [
    { label: 'Base Fee', amount: booking.base_fee },
    { label: 'Distance Fee', amount: booking.distance_fee },
    { label: 'Service Fee', amount: booking.service_fee },
    { label: 'Surcharge', amount: booking.surcharge },
    ...(booking.promo_discount > 0
      ? [{ label: 'Promo Discount', amount: -booking.promo_discount }]
      : []),
  ];

  const handleRebook = async () => {
    setRebooking(true);
    try {
      await bookingService.rebookErrand(booking.id);
      onClose();
      router.push('/(customer)/book/review');
    } catch {
      // Handle error
    } finally {
      setRebooking(false);
    }
  };

  return (
    <BottomSheet
      isVisible={isVisible}
      onClose={onClose}
      snapPoints={[0.75]}
    >
      <ScrollView className="px-5 pb-6" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-lg font-montserrat-bold text-textPrimary">
            Booking Details
          </Text>
          <View
            className="px-2 py-1 rounded-full"
            style={{ backgroundColor: statusColor + '20' }}
          >
            <Text
              className="text-xs font-montserrat-bold"
              style={{ color: statusColor }}
            >
              {statusLabel}
            </Text>
          </View>
        </View>

        {/* Booking Info */}
        <View className="bg-surface border border-divider rounded-xl p-3 mb-4">
          <Text className="text-xs font-montserrat text-textSecondary">
            {booking.booking_number}
          </Text>
          <View className="flex-row items-center mt-1">
            <Calendar size={12} color="#94A3B8" />
            <Text className="text-xs font-montserrat text-textSecondary ml-1">
              {formatFullDate(booking.created_at)} at{' '}
              {formatTime(booking.created_at)}
            </Text>
          </View>
          <Text className="text-sm font-montserrat-bold text-textPrimary mt-2">
            {booking.errand_type?.name ?? 'Errand'}
          </Text>
        </View>

        {/* Route */}
        <View className="bg-surface border border-divider rounded-xl p-3 mb-4">
          <View className="flex-row items-center mb-2">
            <MapPin size={14} color="#2563EB" />
            <Text
              className="text-sm font-montserrat text-textPrimary ml-2 flex-1"
              numberOfLines={2}
            >
              {booking.pickup_address}
            </Text>
          </View>
          <View className="flex-row items-center">
            <MapPin size={14} color="#EF4444" />
            <Text
              className="text-sm font-montserrat text-textPrimary ml-2 flex-1"
              numberOfLines={2}
            >
              {booking.dropoff_address}
            </Text>
          </View>
        </View>

        {/* Payment */}
        <View className="bg-surface border border-divider rounded-xl p-3 mb-4">
          <Text className="text-sm font-montserrat-bold text-textPrimary mb-2">
            Payment
          </Text>
          <PriceBreakdown items={priceItems} total={booking.total_amount} />
        </View>

        {/* Actions */}
        {booking.status === 'completed' && (
          <View className="gap-2">
            <Button
              title="Re-book"
              icon={RefreshCw}
              onPress={handleRebook}
              loading={rebooking}
              fullWidth
            />
          </View>
        )}
      </ScrollView>
    </BottomSheet>
  );
}
