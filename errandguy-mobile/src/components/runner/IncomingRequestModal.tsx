import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, Vibration } from 'react-native';
import { MapPin, Navigation, Truck } from 'lucide-react-native';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { formatCurrency } from '../../utils/formatCurrency';
import type { Booking } from '../../types';

interface IncomingRequestModalProps {
  booking: Booking;
  onAccept: () => void;
  onDecline: () => void;
  timeoutSeconds?: number;
}

export function IncomingRequestModal({
  booking,
  onAccept,
  onDecline,
  timeoutSeconds = 30,
}: IncomingRequestModalProps) {
  const [remaining, setRemaining] = useState(timeoutSeconds);

  useEffect(() => {
    Vibration.vibrate([0, 500, 200, 500]);
  }, []);

  useEffect(() => {
    if (remaining <= 0) {
      onDecline();
      return;
    }
    const timer = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, onDecline]);

  const progress = remaining / timeoutSeconds;

  return (
    <View className="absolute inset-0 bg-black/60 justify-center items-center px-6 z-50">
      <View className="bg-background rounded-3xl p-6 w-full max-w-sm">
        {/* Countdown Ring */}
        <View className="items-center mb-4">
          <View className="w-16 h-16 rounded-full border-4 border-divider items-center justify-center">
            <View
              className="absolute w-16 h-16 rounded-full border-4 border-primary"
              style={{ opacity: progress }}
            />
            <Text className="text-xl font-montserrat-bold text-primary">
              {remaining}
            </Text>
          </View>
          <Text className="text-xs font-montserrat text-textSecondary mt-2">
            seconds to respond
          </Text>
        </View>

        {/* Errand Type + Transportation Badge */}
        <View className="flex-row items-center gap-2 mb-3">
          <Text className="text-base font-montserrat-bold text-textPrimary">
            {booking.errand_type?.name ?? 'New Errand'}
          </Text>
          {booking.is_transportation && (
            <Badge label="🚗 Transportation" variant="primary" size="sm" />
          )}
        </View>

        {/* Addresses */}
        <View className="mb-3">
          <View className="flex-row items-start gap-2 mb-1">
            <MapPin size={14} color="#22C55E" />
            <Text className="text-xs font-montserrat text-textSecondary flex-1" numberOfLines={2}>
              {booking.pickup_address}
            </Text>
          </View>
          <View className="flex-row items-start gap-2">
            <Navigation size={14} color="#EF4444" />
            <Text className="text-xs font-montserrat text-textSecondary flex-1" numberOfLines={2}>
              {booking.dropoff_address}
            </Text>
          </View>
        </View>

        {/* Distance + Payout */}
        <View className="flex-row items-center justify-between mb-4 bg-primaryLight rounded-xl p-3">
          <View className="flex-row items-center gap-1">
            <Truck size={14} color="#2563EB" />
            <Text className="text-xs font-montserrat text-primary">
              {booking.distance_km ? `${booking.distance_km} km` : '--'}
            </Text>
          </View>
          <Text className="text-xl font-montserrat-bold text-primary">
            {formatCurrency(booking.runner_payout ?? booking.total_amount)}
          </Text>
        </View>

        {booking.is_transportation && (
          <Text className="text-xs font-montserrat text-warning text-center mb-3">
            PIN verification required before ride starts
          </Text>
        )}

        {/* Buttons */}
        <View className="gap-2">
          <Button title="Accept" onPress={onAccept} fullWidth />
          <Button title="Decline" variant="outline" onPress={onDecline} fullWidth />
        </View>
      </View>
    </View>
  );
}
