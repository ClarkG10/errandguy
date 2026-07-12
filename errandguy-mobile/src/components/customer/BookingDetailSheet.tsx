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
import * as Haptics from 'expo-haptics';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Eyebrow } from '../ui/Typography';
import { PriceBreakdown } from '../ui/PriceBreakdown';
import { bookingService } from '../../services/booking.service';
import { toast } from '../../stores/toastStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatFullDate, formatTime } from '../../utils/formatDate';
import {
  STATUS_LABELS,
  STATUS_COLORS,
  STATUS_TEXT_COLORS,
  TRACKABLE_STATUSES,
} from '../../constants/statusLabels';
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
  // Small status text takes the AA-safe *Dark rung; the base tone is
  // reserved for the pill wash (see statusLabels.ts convention).
  const statusTextColor =
    STATUS_TEXT_COLORS[booking.status] ?? LightColors.textSecondary;
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
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      onClose();
      router.push('/(customer)/book/review');
    } catch (err: any) {
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Error,
      ).catch(() => {});
      toast.error(
        err?.response?.data?.message ??
          "Couldn't rebook this errand. Please try again.",
      );
    } finally {
      setRebooking(false);
    }
  };

  const handleTrack = () => {
    onClose();
    router.push(`/(customer)/tracking/${booking.id}`);
  };

  const isLive = TRACKABLE_STATUSES.includes(booking.status);
  const rebookable = ['completed', 'delivered', 'cancelled', 'no_runner'].includes(
    booking.status,
  );
  // Terminal-success rebooks celebrate ("Book again"); failure-state
  // rebooks read as recovery, so they get the quieter secondary variant.
  const rebookIsRecovery =
    booking.status === 'cancelled' || booking.status === 'no_runner';

  return (
    // scrollable={false}: the sheet owns a single ScrollView below —
    // BottomSheet's default inner ScrollView would nest two vertical
    // scrollables and double the gutters.
    <BottomSheet
      isVisible={isVisible}
      onClose={onClose}
      snapPoints={[0.85]}
      scrollable={false}
    >
      {/* px-1 on top of BottomSheet's px-4 wrapper = the screen's 20px gutter */}
      <ScrollView className="px-1 pb-8" showsVerticalScrollIndicator={false}>
        {/* ── Hero header ── */}
        <View className="items-center pt-1 pb-4">
          <View
            className="px-3 py-1 rounded-full mb-3"
            style={{ backgroundColor: statusColor + '18' }}
          >
            <Eyebrow color={statusTextColor}>{statusLabel}</Eyebrow>
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
            {/* Identifiers/tabular data use Inter per the type system */}
            <Text className="text-[11px] font-inter text-textSecondary ml-1.5 tabular-nums">
              {booking.booking_number}
            </Text>
          </View>
          <View className="flex-row items-center">
            <Calendar size={12} color={LightColors.textMuted} strokeWidth={2} />
            <Text className="text-[11px] font-inter text-textSecondary ml-1.5 tabular-nums">
              {formatFullDate(booking.created_at)} · {formatTime(booking.created_at)}
            </Text>
          </View>
        </View>

        {/* ── Route — typographic two-line stack with hairline connector. */}
        <Eyebrow className="mb-2">Route</Eyebrow>
        <View className="mb-5">
          <View className="flex-row items-center">
            <View
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: LightColors.success }}
            />
            <View className="flex-1 ml-3">
              <Eyebrow>Pickup</Eyebrow>
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
              <Eyebrow>Drop-off</Eyebrow>
              <Text className="text-[14px] font-montserrat-semi text-textPrimary" numberOfLines={2}>
                {booking.dropoff_address ?? '—'}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Payment breakdown ── */}
        <Eyebrow className="mb-2">Payment</Eyebrow>
        <View className="mb-5">
          <PriceBreakdown items={priceItems} total={booking.total_amount} />
        </View>

        {/* ── Actions — live bookings get a single Track CTA (the details
            link navigated to the same tracking screen, so keeping both
            would be two labels for one destination). Terminal bookings
            get rebook + the details link. ── */}
        <View className="gap-2.5">
          {isLive ? (
            <Button
              title="Track this errand"
              icon={NavIcon}
              onPress={handleTrack}
              fullWidth
            />
          ) : (
            <>
              {rebookable && (
                <Button
                  title={rebookIsRecovery ? 'Rebook this errand' : 'Book again'}
                  variant={rebookIsRecovery ? 'secondary' : 'primary'}
                  icon={RefreshCw}
                  onPress={handleRebook}
                  loading={rebooking}
                  loadingTitle="Rebooking…"
                  fullWidth
                />
              )}
              <Pressable
                onPress={() => {
                  // Raw Pressable → self-fire the light tap (Button handles its own)
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                    () => {},
                  );
                  handleTrack();
                }}
                className="flex-row items-center justify-center py-3"
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="View full errand details"
              >
                <Text className="text-[12px] font-montserrat-bold text-primary mr-1">
                  View full details
                </Text>
                <ChevronRight size={14} color={LightColors.primary} strokeWidth={2.4} />
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </BottomSheet>
  );
}
