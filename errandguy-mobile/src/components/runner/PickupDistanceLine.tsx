import React from 'react';
import { View, Text } from 'react-native';
import { LocateFixed } from 'lucide-react-native';
import { useLocationStore } from '../../stores/locationStore';
import { useEta } from '../../hooks/useEta';
import type { Booking } from '../../types';
import { LightColors } from '../../constants/colors';

interface PickupDistanceLineProps {
  booking: Booking;
  /** Optional tone override for on-dark surfaces (e.g. the slate payout box). */
  variant?: 'default' | 'onDark';
}

/**
 * "Pickup 1.2 km · ~5 min away" — how far the runner is from the *pickup*
 * (distinct from the trip distance the offer already shows), the number
 * that actually decides an accept. Origin is the runner's live GPS from
 * `locationStore`; destination is the booking's pickup coordinate. Uses
 * the shared `useEta` hook so distance (straight-line haversine) and ETA
 * (cached Mapbox Directions, with a 30 km/h straight-line fallback) match
 * the in-nav numbers.
 *
 * Renders nothing when the runner's location is unknown or the pickup has
 * no coordinate — a graceful hide, never a "0 m" or "-- away" placeholder.
 */
export function PickupDistanceLine({ booking, variant = 'default' }: PickupDistanceLineProps) {
  const currentLocation = useLocationStore((s) => s.currentLocation);

  const destination =
    booking.pickup_lat != null && booking.pickup_lng != null
      ? { lat: booking.pickup_lat, lng: booking.pickup_lng }
      : null;

  const { distanceMeters, minutes } = useEta(currentLocation, destination);

  // No live location (or no pickup coord) → hide entirely.
  if (distanceMeters == null) return null;

  const distanceLabel =
    distanceMeters < 950
      ? `${Math.max(1, Math.round(distanceMeters / 10) * 10)} m`
      : `${(distanceMeters / 1000).toFixed(1)} km`;

  const etaLabel = minutes != null ? ` · ~${minutes} min away` : '';
  const label = `Pickup ${distanceLabel}${etaLabel}`;

  const onDark = variant === 'onDark';
  const iconColor = onDark ? LightColors.textInverse : LightColors.primary;
  const textClass = onDark ? 'text-white/80' : 'text-textSecondary';

  return (
    <View
      className="flex-row items-center gap-1.5"
      accessible
      accessibilityRole="text"
      accessibilityLabel={
        minutes != null
          ? `Pickup is ${distanceLabel} away, about ${minutes} minutes`
          : `Pickup is ${distanceLabel} away`
      }
    >
      <LocateFixed size={13} color={iconColor} strokeWidth={2} />
      <Text className={`text-xs font-montserrat tabular-nums ${textClass}`}>{label}</Text>
    </View>
  );
}
