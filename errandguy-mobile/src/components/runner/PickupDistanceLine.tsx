import React from 'react';
import { View, Text } from 'react-native';
import { LocateFixed } from 'lucide-react-native';
import { useLocationStore } from '../../stores/locationStore';
import { useEta } from '../../hooks/useEta';
import { formatEtaMinutes } from '../../services/route.service';
import type { Booking } from '../../types';
import { LightColors } from '../../constants/colors';

interface PickupDistanceLineProps {
  booking: Booking;
  /** Optional tone override for on-dark surfaces (e.g. the slate payout box). */
  variant?: 'default' | 'onDark';
  /**
   * Server-measured km from the runner's last GPS ping to this pickup
   * (`distance_to_pickup_km`, attached by RunnerErrandController to the offer
   * feed and the matched offer). Used ONLY when there is no live fix yet —
   * cold start, GPS still warming — so an offer card always states how far
   * away the job is instead of showing nothing at the exact moment the runner
   * is deciding. Labelled "approx." because the ping can be minutes old.
   */
  fallbackKm?: number | null;
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
export function PickupDistanceLine({
  booking,
  variant = 'default',
  fallbackKm = null,
}: PickupDistanceLineProps) {
  const currentLocation = useLocationStore((s) => s.currentLocation);

  const destination =
    booking.pickup_lat != null && booking.pickup_lng != null
      ? { lat: booking.pickup_lat, lng: booking.pickup_lng }
      : null;

  const { distanceMeters, minutes } = useEta(currentLocation, destination);

  const hasLiveFix = distanceMeters != null;
  const hasFallback = fallbackKm != null && Number.isFinite(fallbackKm) && fallbackKm > 0;

  // No live location (or no pickup coord) AND no server figure → hide
  // entirely, never a "0 m" / "-- away" placeholder.
  if (!hasLiveFix && !hasFallback) return null;

  const distanceLabel = hasLiveFix
    ? distanceMeters! < 950
      ? `${Math.max(1, Math.round(distanceMeters! / 10) * 10)} m`
      : `${(distanceMeters! / 1000).toFixed(1)} km`
    : `${(fallbackKm as number).toFixed(1)} km`;

  // Through the shared renderer, not a local `${minutes} min`: it carries the
  // hour rollover ("1h 35m" instead of "95 min" on a cross-city pickup) and
  // the singular, so a one-minute ETA no longer reads "1 minutes".
  const etaText = hasLiveFix ? formatEtaMinutes(minutes) : null;
  const etaLabel = etaText ? ` · ~${etaText} away` : '';
  // Only the SERVER figure is hedged — the live client fix is exact.
  const label = hasLiveFix
    ? `Pickup ${distanceLabel}${etaLabel}`
    : `Pickup approx. ${distanceLabel} away`;

  const onDark = variant === 'onDark';
  const iconColor = onDark ? LightColors.textInverse : LightColors.primary;
  const textClass = onDark ? 'text-white/80' : 'text-textSecondary';

  return (
    <View
      className="flex-row items-center gap-1.5"
      accessible
      accessibilityRole="text"
      accessibilityLabel={
        !hasLiveFix
          ? `Pickup is about ${distanceLabel} away`
          : etaText
            ? `Pickup is ${distanceLabel} away, about ${etaText}`
            : `Pickup is ${distanceLabel} away`
      }
    >
      <LocateFixed size={13} color={iconColor} strokeWidth={2} />
      <Text className={`text-xs font-montserrat tabular-nums ${textClass}`}>{label}</Text>
    </View>
  );
}
