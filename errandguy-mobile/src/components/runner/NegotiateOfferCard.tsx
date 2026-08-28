import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { MapPin, Clock, Navigation } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { PickupDistanceLine } from './PickupDistanceLine';
import { PaymentChip, ScheduledChip, StopsChip } from './OfferChips';
import { readServerPickupKm } from './offerMeta';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatRunnerPayout } from '../../utils/runnerPayout';
import { formatDistanceKm } from '../../utils/formatDistance';
import { getErrandTypeRule } from '../../constants/errandTypeRules';
import type { Booking } from '../../types';
import { LightColors } from '../../constants/colors';

interface NegotiateOfferCardProps {
  booking: Booking;
  /** Open the full offer details (the surface that can also accept). */
  onPress: () => void;
  /** One-tap claim straight from the list. Omit to hide the Accept action. */
  onAccept?: () => void | Promise<void>;
  /** True while THIS offer's accept is in flight. */
  accepting?: boolean;
  /** True while some other offer's accept is in flight (locks the row). */
  busy?: boolean;
}

export function NegotiateOfferCard({
  booking,
  onPress,
  onAccept,
  accepting = false,
  busy = false,
}: NegotiateOfferCardProps) {
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

  // The runner's real take-home. This card used to lead with
  // `customer_offer ?? total_amount` — the GROSS the customer pays — while the
  // fixed-offer modal led with `runner_payout` (gross minus the service fee),
  // so the two offer surfaces quoted different numbers for comparable jobs and
  // the haircut only surfaced after the errand was done. Every offer surface
  // now quotes take-home, with the customer's figure as a caption.
  const gross = booking.customer_offer ?? booking.total_amount;
  const payoutKnown = booking.runner_payout != null;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  return (
    // padding="none" + overflow-hidden so the body Pressable fills the card:
    // its Android ripple then clips to the rounded corners instead of
    // rippling a bare rectangle inset inside them.
    <Card padding="none" className="mb-3 overflow-hidden">
      <Pressable
        className="p-4"
        onPress={handlePress}
        disabled={busy || accepting}
        accessibilityRole="button"
        accessibilityLabel={`${booking.errand_type?.name ?? 'Errand'} offer, ${formatRunnerPayout(
          booking.runner_payout,
        )}`}
        accessibilityHint="Opens the full offer details"
        android_ripple={{ color: `${LightColors.primary}14` }}
        style={({ pressed }) => (pressed ? { opacity: 0.96 } : undefined)}
      >
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

        {/* Decision-critical facts the card used to omit: how it settles and
            how much cash changes hands, whether it's a scheduled window, and
            whether there are extra stops. */}
        <View className="flex-row flex-wrap items-center gap-1.5 mb-2">
          <PaymentChip booking={booking} />
          <ScheduledChip booking={booking} />
          <StopsChip booking={booking} />
        </View>

        <View className="flex-row items-start gap-2 mb-2">
          <MapPin size={14} color={LightColors.success} />
          <Text className="text-xs font-montserrat text-textSecondary flex-1" numberOfLines={1}>
            {booking.pickup_address}
          </Text>
        </View>
        {showDropoff && (
          <View className="flex-row items-start gap-2 mb-2">
            <Navigation size={14} color={LightColors.danger} />
            <Text className="text-xs font-montserrat text-textSecondary flex-1" numberOfLines={1}>
              {booking.dropoff_address}
            </Text>
          </View>
        )}

        {booking.description ? (
          <Text
            className="text-xs font-montserrat text-textTertiary mb-2"
            numberOfLines={2}
          >
            {booking.description}
          </Text>
        ) : null}

        {/* Live distance to the pickup — the key accept signal, distinct
            from the trip distance below. Falls back to the server's
            approximate figure before the first GPS fix lands. */}
        <View className="mb-2">
          <PickupDistanceLine booking={booking} fallbackKm={readServerPickupKm(booking)} />
        </View>

        <View className="flex-row items-end justify-between">
          <Text className="text-xs font-inter tabular-nums text-textSecondary">
            {formatDistanceKm(booking.distance_km) ?? '--'}
          </Text>
          <View className="items-end">
            <Text className="text-lg font-inter-semi tabular-nums text-primary">
              {formatRunnerPayout(booking.runner_payout)}
            </Text>
            <Text className="text-[10px] font-montserrat tabular-nums text-textTertiary">
              {payoutKnown ? `You earn · customer pays ${formatCurrency(gross)}` : 'Payout pending'}
            </Text>
          </View>
        </View>
      </Pressable>

      {onAccept ? (
        <View className="px-4 pb-4 -mt-1">
          <Button
            title="Accept"
            size="sm"
            onPress={onAccept}
            loading={accepting}
            loadingTitle="Accepting…"
            disabled={busy || accepting}
            fullWidth
          />
        </View>
      ) : null}
    </Card>
  );
}
