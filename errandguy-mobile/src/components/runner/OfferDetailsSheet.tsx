import React from 'react';
import { View, Text } from 'react-native';
import {
  ClipboardList,
  MapPin,
  Navigation,
  Route,
  ShoppingBag,
  Truck,
} from 'lucide-react-native';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { PickupDistanceLine } from './PickupDistanceLine';
import { PaymentChip, ScheduledChip } from './OfferChips';
import { readServerPickupKm } from './offerMeta';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatRunnerPayout } from '../../utils/runnerPayout';
import { formatDistanceKm } from '../../utils/formatDistance';
import { getErrandTypeRule } from '../../constants/errandTypeRules';
import type { Booking } from '../../types';
import { LightColors } from '../../constants/colors';

interface OfferDetailsSheetProps {
  /** The offer to show. Null keeps the sheet closed. */
  booking: Booking | null;
  onClose: () => void;
  onAccept: () => void | Promise<void>;
  accepting?: boolean;
}

/**
 * Full detail view for an OPEN (negotiate-mode) offer — and the only place
 * outside the fixed-match modal where a runner can actually claim one.
 *
 * WHY this exists: tapping an open offer used to push
 * `/(runner)/errand/{id}`, but that endpoint is scoped to the runner's OWN
 * bookings (`runnerBookings()`), and an open negotiate booking has
 * `runner_id = NULL` — so the fetch 404'd and the runner landed on
 * "Errand unavailable · Go Back". There was no accept call site for
 * negotiate jobs anywhere in the app: a runner could see the job, tap it,
 * hit an error screen, and watch it expire.
 *
 * Rather than widening that server scope, this sheet renders entirely from
 * the payload the offer FEED already returned (GET /runner/errand/available),
 * which BookingResource has already masked for a non-participant — no
 * contacts, no item photos, no ride PIN. Nothing new is fetched, so nothing
 * new is exposed.
 */
export function OfferDetailsSheet({
  booking,
  onClose,
  onAccept,
  accepting = false,
}: OfferDetailsSheetProps) {
  const rule = getErrandTypeRule(booking?.errand_type?.slug);
  const showDropoff =
    !!booking &&
    !rule.singleLocation &&
    !!booking.dropoff_address &&
    booking.dropoff_address !== booking.pickup_address;
  const stops = booking?.stops ?? [];
  const gross = booking ? booking.customer_offer ?? booking.total_amount : 0;

  return (
    <BottomSheet
      isVisible={!!booking}
      onClose={onClose}
      snapPoints={[0.8]}
      scrollable
      avoidKeyboard={false}
    >
      {booking ? (
        // BottomSheet already applies its own px-4 gutter.
        <View className="pb-8">
          <Text className="text-lg font-montserrat-bold text-textPrimary">
            {booking.errand_type?.name ?? 'Errand'}
          </Text>
          <Text className="text-[11px] font-montserrat text-textTertiary mt-0.5">
            Offer #{booking.booking_number}
          </Text>

          <View className="flex-row flex-wrap items-center gap-1.5 mt-3">
            <PaymentChip booking={booking} />
            <ScheduledChip booking={booking} />
          </View>

          {/* Take-home first — the same figure the fixed-offer modal leads
              with — then what the customer pays, so the service-fee haircut
              is visible BEFORE the job, not discovered after it. */}
          <View
            className="flex-row items-center justify-between rounded-xl p-3.5 mt-4 overflow-hidden"
            style={{ backgroundColor: LightColors.textPrimary }}
          >
            <View className="flex-1 pr-3">
              <Text className="text-[10px] font-montserrat-bold uppercase text-white/70">
                You earn
              </Text>
              <Text className="text-2xl font-inter-semi tabular-nums text-white mt-0.5">
                {formatRunnerPayout(booking.runner_payout)}
              </Text>
              {booking.runner_payout != null ? (
                <Text className="text-[11px] font-montserrat tabular-nums text-white/70 mt-0.5">
                  Customer pays {formatCurrency(gross)}
                </Text>
              ) : null}
            </View>
            <View className="items-end">
              <View className="flex-row items-center gap-1.5">
                <Truck size={14} color={LightColors.textInverse} />
                <Text className="text-xs font-inter tabular-nums text-white/80">
                  {formatDistanceKm(booking.distance_km) ?? 'On-site'}
                </Text>
              </View>
              <View className="mt-1.5">
                <PickupDistanceLine
                  booking={booking}
                  variant="onDark"
                  fallbackKm={readServerPickupKm(booking)}
                />
              </View>
            </View>
          </View>

          {/* Route */}
          <View className="mt-4">
            <View className="flex-row items-start gap-2 mb-2">
              <MapPin size={15} color={LightColors.success} />
              <Text className="text-[13px] font-montserrat text-textSecondary flex-1">
                {booking.pickup_address}
              </Text>
            </View>
            {showDropoff && (
              <View className="flex-row items-start gap-2">
                <Navigation size={15} color={LightColors.danger} />
                <Text className="text-[13px] font-montserrat text-textSecondary flex-1">
                  {booking.dropoff_address}
                </Text>
              </View>
            )}
            {stops.map((stop) => (
              <View key={stop.id} className="flex-row items-start gap-2 mt-2">
                <Route size={15} color={LightColors.primary} />
                <Text className="text-[13px] font-montserrat text-textSecondary flex-1">
                  Stop {stop.sequence} · {stop.address}
                </Text>
              </View>
            ))}
          </View>

          {/* Shopping ceiling — the runner fronts this money, so it must be
              visible before they commit. */}
          {rule.requiresShoppingBudget && booking.shopping_budget != null && (
            <View className="flex-row items-center gap-2 bg-warningSoft border border-warning/40 rounded-xl p-3 mt-4">
              <ShoppingBag size={15} color={LightColors.warningDark} />
              <Text className="text-xs font-montserrat text-warningDark flex-1">
                Customer budget cap
              </Text>
              <Text className="text-sm font-inter-semi tabular-nums text-warningDark">
                {formatCurrency(booking.shopping_budget)}
              </Text>
            </View>
          )}

          {booking.description ? (
            <View className="mt-4">
              <Text className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-1">
                What&apos;s needed
              </Text>
              <Text className="text-[13px] font-montserrat text-textPrimary">
                {booking.description}
              </Text>
            </View>
          ) : null}

          {booking.special_instructions ? (
            <View className="mt-4 flex-row items-start gap-2 bg-surfaceMuted rounded-xl p-3">
              <ClipboardList size={15} color={LightColors.textSecondary} />
              <View className="flex-1">
                <Text className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-0.5">
                  Special instructions
                </Text>
                <Text className="text-[13px] font-montserrat text-textPrimary">
                  {booking.special_instructions}
                </Text>
              </View>
            </View>
          ) : null}

          <View className="mt-6">
            <Button
              title="Accept errand"
              onPress={onAccept}
              loading={accepting}
              loadingTitle="Accepting…"
              disabled={accepting}
              fullWidth
            />
            <View className="mt-3">
              <Button
                title="Close"
                variant="ghost"
                onPress={onClose}
                disabled={accepting}
                fullWidth
              />
            </View>
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}
