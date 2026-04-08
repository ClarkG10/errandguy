import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { MapPin, Clock, Navigation } from 'lucide-react-native';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { formatCurrency } from '../../utils/formatCurrency';
import type { Booking } from '../../types';

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

  return (
    <Pressable onPress={onPress}>
      <Card className="p-4 mb-3">
        <View className="flex-row items-center justify-between mb-2">
          <Badge
            label={booking.errand_type?.name ?? 'Errand'}
            variant="primary"
            size="sm"
          />
          {remainingMin > 0 && (
            <View className="flex-row items-center gap-1">
              <Clock size={12} color="#F59E0B" />
              <Text className="text-xs font-montserrat text-warning">
                {remainingMin}m left
              </Text>
            </View>
          )}
        </View>

        <View className="flex-row items-start gap-2 mb-2">
          <MapPin size={14} color="#22C55E" />
          <Text className="text-xs font-montserrat text-textSecondary flex-1" numberOfLines={1}>
            {booking.pickup_address}
          </Text>
        </View>
        <View className="flex-row items-start gap-2 mb-3">
          <Navigation size={14} color="#EF4444" />
          <Text className="text-xs font-montserrat text-textSecondary flex-1" numberOfLines={1}>
            {booking.dropoff_address}
          </Text>
        </View>

        <View className="flex-row items-center justify-between">
          <Text className="text-xs font-montserrat text-textSecondary">
            {booking.distance_km ? `${booking.distance_km} km` : '--'}
          </Text>
          <Text className="text-lg font-montserrat-bold text-primary">
            {formatCurrency(booking.customer_offer ?? booking.total_amount)}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}
