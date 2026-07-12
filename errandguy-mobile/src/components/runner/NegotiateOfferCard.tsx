import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { MapPin, Clock, Navigation } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { formatCurrency } from '../../utils/formatCurrency';
import { getErrandTypeRule } from '../../constants/errandTypeRules';
import type { Booking } from '../../types';
import { LightColors } from '../../constants/colors';

interface NegotiateOfferCardProps {
  booking: Booking;
  onPress: () => void;
}

export function NegotiateOfferCard({ booking, onPress }: NegotiateOfferCardProps) {
  const expiresAt = booking.negotiate_expires_at
    ? new Date(booking.negotiate_expires_at)
    : null;
  const now = new Date();
  const remainingMs = expiresAt ? expiresAt.getTime() - now.getTime() : 0;
  const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));

  // Mirror the incoming-request modal: single-location / on-site errands
  // have no distinct drop-off, so don't render a blank or duplicate row.
  const errandRule = getErrandTypeRule(booking.errand_type?.slug);
  const showDropoff =
    !errandRule.singleLocation &&
    !!booking.dropoff_address &&
    booking.dropoff_address !== booking.pickup_address;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      android_ripple={{ color: `${LightColors.primary}14` }}
      style={({ pressed }) => (pressed ? { opacity: 0.96 } : undefined)}
    >
      <Card className="p-4 mb-3">
        <View className="flex-row items-center justify-between mb-2">
          <Badge
            label={booking.errand_type?.name ?? 'Errand'}
            variant="primary"
            size="sm"
          />
          {remainingMin > 0 && (
            <View className="flex-row items-center gap-1">
              <Clock size={12} color={LightColors.warning} />
              {/* warningDark rung — base amber fails AA at this size. */}
              <Text className="text-xs font-montserrat text-warningDark">
                {remainingMin}m left
              </Text>
            </View>
          )}
        </View>

        <View className="flex-row items-start gap-2 mb-2">
          <MapPin size={14} color={LightColors.success} />
          <Text className="text-xs font-montserrat text-textSecondary flex-1" numberOfLines={1}>
            {booking.pickup_address}
          </Text>
        </View>
        {showDropoff && (
          <View className="flex-row items-start gap-2 mb-3">
            <Navigation size={14} color={LightColors.danger} />
            <Text className="text-xs font-montserrat text-textSecondary flex-1" numberOfLines={1}>
              {booking.dropoff_address}
            </Text>
          </View>
        )}

        <View className="flex-row items-center justify-between">
          <Text className="text-xs font-inter tabular-nums text-textSecondary">
            {booking.distance_km ? `${booking.distance_km} km` : '--'}
          </Text>
          <Text className="text-lg font-inter-semi tabular-nums text-primary">
            {formatCurrency(booking.customer_offer ?? booking.total_amount)}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}
