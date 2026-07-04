import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import {
  RefreshCw,
  Calendar,
  Hash,
  Navigation as NavIcon,
  ChevronRight,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { PriceBreakdown } from '../ui/PriceBreakdown';
import { bookingService } from '../../services/booking.service';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatFullDate, formatTime } from '../../utils/formatDate';
import { STATUS_LABELS, STATUS_COLORS } from '../../constants/statusLabels';
import type { Booking } from '../../types';
import { LightColors } from '../../constants/colors';

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

  const statusColor = STATUS_COLORS[booking.status] ?? LightColors.textMuted;
  const statusLabel = STATUS_LABELS[booking.status] ?? booking.status;

  const priceItems = [
    { label: 'Base Fee', amount: booking.base_fee },
    { label: 'Distance Fee', amount: booking.distance_fee },
    { label: 'Convenience Fee', amount: booking.service_fee },
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

  const handleTrack = () => {
    onClose();
    router.push(`/(customer)/tracking/${booking.id}`);
  };

  const isLive = ['pending', 'matched', 'accepted', 'in_progress'].includes(
    booking.status,
  );

  return (
    <BottomSheet isVisible={isVisible} onClose={onClose} snapPoints={[0.85]}>
      <ScrollView className="px-5 pb-8" showsVerticalScrollIndicator={false}>
        {/* ── Hero header ── */}
        <View className="items-center pt-1 pb-4">
          <View
            className="px-3 py-1 rounded-full mb-3"
            style={{ backgroundColor: statusColor + '18' }}
          >
            <Text
              className="text-[10px] font-montserrat-bold uppercase"
              style={{ color: statusColor, letterSpacing: 1.4 }}
            >
              {statusLabel}
            </Text>
          </View>
          <Text className="text-[20px] font-montserrat-bold text-textPrimary">
            {booking.errand_type?.name ?? 'Errand'}
          </Text>
          <Text className="text-[26px] font-inter-semi text-textPrimary tabular-nums mt-1">
            {formatCurrency(booking.total_amount)}
          </Text>
        </View>

        {/* ── Meta strip ── */}
        <View
          className="flex-row items-center justify-between py-3 border-y border-divider mb-5"
        >
          <View className="flex-row items-center flex-1">
            <Hash size={12} color={LightColors.textMuted} strokeWidth={2} />
            <Text className="text-[11px] font-montserrat text-textSecondary ml-1.5">
              {booking.booking_number}
            </Text>
          </View>
          <View className="flex-row items-center">
            <Calendar size={12} color={LightColors.textMuted} strokeWidth={2} />
            <Text className="text-[11px] font-montserrat text-textSecondary ml-1.5">
              {formatFullDate(booking.created_at)} · {formatTime(booking.created_at)}
            </Text>
          </View>
        </View>

        {/* ── Route — typographic two-line stack with hairline connector. */}
        <Text
          className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-2"
          style={{ letterSpacing: 1.4 }}
        >
          Route
        </Text>
        <View className="mb-5">
          <View className="flex-row items-center">
            <View
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: LightColors.success }}
            />
            <View className="flex-1 ml-3">
              <Text
                className="text-[10px] font-montserrat-bold uppercase text-textSecondary"
                style={{ letterSpacing: 1.2 }}
              >
                Pickup
              </Text>
              <Text className="text-[14px] font-montserrat-semi text-textPrimary" numberOfLines={2}>
                {booking.pickup_address}
              </Text>
            </View>
          </View>
          <View
            style={{
              marginLeft: 3,
              width: 2,
              height: 14,
              backgroundColor: LightColors.surfaceMuted,
              marginVertical: 6,
            }}
          />
          <View className="flex-row items-center">
            <View
              style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: LightColors.textPrimary }}
            />
            <View className="flex-1 ml-3">
              <Text
                className="text-[10px] font-montserrat-bold uppercase text-textSecondary"
                style={{ letterSpacing: 1.2 }}
              >
                Drop-off
              </Text>
              <Text className="text-[14px] font-montserrat-semi text-textPrimary" numberOfLines={2}>
                {booking.dropoff_address ?? '—'}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Payment breakdown ── */}
        <Text
          className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-2"
          style={{ letterSpacing: 1.4 }}
        >
          Payment
        </Text>
        <View className="mb-5">
          <PriceBreakdown items={priceItems} total={booking.total_amount} />
        </View>

        {/* ── Actions ── */}
        <View className="gap-2.5">
          {isLive && (
            <Button
              title="Track this errand"
              icon={NavIcon}
              onPress={handleTrack}
              fullWidth
            />
          )}
          {booking.status === 'completed' && (
            <Button
              title="Book again"
              icon={RefreshCw}
              onPress={handleRebook}
              loading={rebooking}
              fullWidth
            />
          )}
          <Pressable
            onPress={() => {
              onClose();
              router.push(`/(customer)/tracking/${booking.id}`);
            }}
            className="flex-row items-center justify-center py-2"
            hitSlop={6}
          >
            <Text className="text-[12px] font-montserrat-bold text-primary mr-1">
              View full details
            </Text>
            <ChevronRight size={14} color={LightColors.primary} strokeWidth={2.4} />
          </Pressable>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}
