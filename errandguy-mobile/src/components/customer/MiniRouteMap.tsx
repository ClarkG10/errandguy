import React from 'react';
import { View, Text } from 'react-native';
import { MapPin, Navigation } from 'lucide-react-native';

interface MiniRouteMapProps {
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  pickupAddress?: string;
  dropoffAddress?: string;
}

export function MiniRouteMap({
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
  pickupAddress,
  dropoffAddress,
}: MiniRouteMapProps) {
  const hasPickup = pickupLat != null && pickupLng != null;
  const hasDropoff = dropoffLat != null && dropoffLng != null;

  if (!hasPickup && !hasDropoff) return null;

  return (
    <View className="mb-4">
      <Text className="text-sm font-montserrat-bold text-textPrimary mb-2">
        Route Preview
      </Text>
      {/* Mapbox MapView placeholder — will be integrated with @rnmapbox/maps */}
      <View className="h-40 bg-divider rounded-xl items-center justify-center overflow-hidden">
        <View className="flex-1 w-full items-center justify-center">
          <Navigation size={32} color="#94A3B8" />
          <Text className="text-xs font-montserrat text-textSecondary mt-2">
            Map Preview
          </Text>
        </View>

        {/* Route summary overlay */}
        <View className="absolute bottom-0 left-0 right-0 bg-surface/90 px-3 py-2">
          {hasPickup && pickupAddress && (
            <View className="flex-row items-center mb-1">
              <MapPin size={12} color="#2563EB" />
              <Text
                className="text-[10px] font-montserrat text-textPrimary ml-1 flex-1"
                numberOfLines={1}
              >
                {pickupAddress}
              </Text>
            </View>
          )}
          {hasDropoff && dropoffAddress && (
            <View className="flex-row items-center">
              <MapPin size={12} color="#EF4444" />
              <Text
                className="text-[10px] font-montserrat text-textPrimary ml-1 flex-1"
                numberOfLines={1}
              >
                {dropoffAddress}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
