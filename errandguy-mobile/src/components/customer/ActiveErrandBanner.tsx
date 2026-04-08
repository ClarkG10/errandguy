import React from 'react';
import { View, Text } from 'react-native';
import { MapPin, ArrowRight } from 'lucide-react-native';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { STATUS_LABELS, STATUS_COLORS } from '../../constants/statusLabels';
import type { Booking } from '../../types';

interface ActiveErrandBannerProps {
  booking: Booking;
  onTrack: () => void;
}

export function ActiveErrandBanner({ booking, onTrack }: ActiveErrandBannerProps) {
  const statusColor = STATUS_COLORS[booking.status] ?? '#2563EB';
  const statusLabel = STATUS_LABELS[booking.status] ?? booking.status;

  return (
    <Card className="bg-primaryLight border-primary">
      <View className="flex-row items-center mb-2">
        <View
          className="px-2 py-0.5 rounded-full mr-2"
          style={{ backgroundColor: statusColor }}
        >
          <Text className="text-[10px] font-montserrat-bold text-white">
            {statusLabel}
          </Text>
        </View>
        <Text className="text-xs font-montserrat text-textSecondary flex-1">
          {booking.booking_number}
        </Text>
      </View>

      <View className="flex-row items-center mb-3">
        <MapPin size={14} color="#2563EB" />
        <Text
          className="text-sm font-montserrat text-textPrimary ml-1 flex-1"
          numberOfLines={1}
        >
          {booking.pickup_address}
        </Text>
        <ArrowRight size={14} color="#94A3B8" className="mx-1" />
        <Text
          className="text-sm font-montserrat text-textPrimary flex-1"
          numberOfLines={1}
        >
          {booking.dropoff_address}
        </Text>
      </View>

      <Button title="Track" size="sm" onPress={onTrack} fullWidth />
    </Card>
  );
}
