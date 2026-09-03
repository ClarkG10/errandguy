import React from 'react';
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
import { warmTracking } from '../../services/preload.service';
import { useBookingStore, type DraftBooking } from '../../stores/bookingStore';
import { toast } from '../../stores/toastStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { fareLines } from '../../utils/fareLines';
import { formatFullDate, formatTime } from '../../utils/formatDate';
import {
  statusLabel as statusLabelFor,
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

/**
 * The money outcome of a terminal booking, read off the fields the server
 * already derives (BookingResource: `cancellation_fee`, `refunded_amount`,
 * `refund_destination`).
 *
 * NOTHING is computed here — the fee is capped/zeroed server-side (PRICE-3 /
 * PRICE-4) and a client-side "total − policy fee" would print a phantom
 * charge, which is exactly why the arithmetic lives in one place on the
 * server. This only normalises Laravel's decimal-as-string casts and answers
 * the one question a receipt has to answer: did money move, and where did it
 * go?
 *
 * Exported (and shared with the tracking receipt) so the cancelled errand
 * tells the same story on every surface it appears on.
 */
export type BookingMoneyOutcome = {
  /** Cancellation fee actually kept by the platform. */
  fee: number;
  /** Peso amount credited back, or null when nothing was ever returned. */
  refunded: number | null;
  /** Where the refund landed. 'wallet' is the only destination today. */
  destination: 'wallet' | null;
  /** True when money changed hands at all on this booking. */
  moneyMoved: boolean;
};

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function bookingMoneyOutcome(booking: Booking): BookingMoneyOutcome {
  // Additive server fields; the shared Booking type predates them.
  const b = booking as Booking & {
    refunded_amount?: number | string | null;
    refund_destination?: 'wallet' | null;
  };
  const fee = num(b.cancellation_fee);
  const refunded =
    b.refunded_amount === null || b.refunded_amount === undefined
      ? null
      : num(b.refunded_amount);

  return {
    fee,
    refunded,
    // Only claim a destination when there is actually something in flight.
    destination: refunded != null && refunded > 0 ? (b.refund_destination ?? 'wallet') : null,
    moneyMoved: fee > 0 || (refunded != null && refunded > 0),
  };
}

/**
 * Clone a terminal booking into a fresh booking draft so "Book again" can
 * drop the customer straight onto the pre-filled Review screen — no backend
 * round-trip, no duplicate booking form.
 *
 * The route can only be reconstructed when the source booking carries pickup
 * coordinates (the estimate + submit both key off them). When it doesn't, we
 * degrade to seeding just the errand type so the customer still lands on the
 * right flow and re-picks their locations, rather than a dead-end draft.
 */
function buildDraftFromBooking(b: Booking): Partial<DraftBooking> {
  // Slug lives on the (optional) errand_type relation; the id is always present.
  const slug = b.errand_type?.slug;
  const typeSeed: Partial<DraftBooking> = {
    errand_type_id: b.errand_type_id,
    ...(slug ? { errand_type_slug: slug } : {}),
  };

  const hasPickupCoords = b.pickup_lat != null && b.pickup_lng != null;
  if (!hasPickupCoords) return typeSeed;

  return {
    ...typeSeed,
    pickup_address: b.pickup_address,
    pickup_lat: b.pickup_lat,
    pickup_lng: b.pickup_lng,
    ...(b.pickup_contact_name ? { pickup_contact_name: b.pickup_contact_name } : {}),
    ...(b.pickup_contact_phone ? { pickup_contact_phone: b.pickup_contact_phone } : {}),
    ...(b.dropoff_address != null ? { dropoff_address: b.dropoff_address } : {}),
    ...(b.dropoff_lat != null ? { dropoff_lat: b.dropoff_lat } : {}),
    ...(b.dropoff_lng != null ? { dropoff_lng: b.dropoff_lng } : {}),
    ...(b.dropoff_contact_name ? { dropoff_contact_name: b.dropoff_contact_name } : {}),
    ...(b.dropoff_contact_phone ? { dropoff_contact_phone: b.dropoff_contact_phone } : {}),
    ...(b.description != null ? { description: b.description } : {}),
    ...(b.special_instructions != null
      ? { special_instructions: b.special_instructions }
      : {}),
    ...(b.estimated_item_value != null
      ? { estimated_item_value: b.estimated_item_value }
      : {}),
    ...(b.shopping_budget != null ? { shopping_budget: b.shopping_budget } : {}),
    ...(b.pricing_mode ? { pricing_mode: b.pricing_mode } : {}),
    ...(b.vehicle_type_rate ? { vehicle_type_rate: b.vehicle_type_rate } : {}),
    ...(b.customer_offer != null ? { customer_offer: b.customer_offer } : {}),
    // Re-seed the shopping checklist with the ticks reset — the runner starts
    // a fresh run. (No structured items column ⇒ Review re-serializes it.)
    ...(b.shopping_items && b.shopping_items.length > 0
      ? {
          shoppingItems: b.shopping_items.map((it) => ({
            id: it.id,
            name: it.name,
            qty: it.qty,
          })),
        }
      : {}),
    // Deliberately NOT cloned: promo_code (single-use/expiry) and any
    // payment selection — the customer re-confirms those on Review.
  };
}

export function BookingDetailSheet({
  booking,
  isVisible,
  onClose,
}: BookingDetailSheetProps) {
  const router = useRouter();
  const updateDraft = useBookingStore((s) => s.updateDraft);
  const clearDraft = useBookingStore((s) => s.clearDraft);

  if (!booking) return null;

  const statusColor = STATUS_COLORS[booking.status] ?? LightColors.textMuted;
  // Small status text takes the AA-safe *Dark rung; the base tone is
  // reserved for the pill wash (see statusLabels.ts convention).
  const statusTextColor =
    STATUS_TEXT_COLORS[booking.status] ?? LightColors.textSecondary;
  // Type-aware so the sheet's eyebrow agrees with the Activity row it was
  // opened from and with the tracking hero (a bill payment reads "Bill paid",
  // never "Picked up").
  const statusLabel = statusLabelFor(booking.status, booking.errand_type?.slug);

  const priceItems = fareLines(booking, booking.promo_discount);

  const handleRebook = () => {
    const draft = buildDraftFromBooking(booking);
    // Route is reconstructable only when we managed to seed pickup coords;
    // otherwise we fell back to the type-only seed and the customer needs to
    // re-pick their locations on Review.
    const routeSeeded = draft.pickup_lat != null;

    // Replace any in-progress draft wholesale — a rebook is a clean start,
    // not a merge onto whatever half-filled draft was lying around.
    clearDraft();
    updateDraft(draft);

    Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    ).catch(() => {});
    onClose();
    router.push('/(customer)/book/review');

    if (!routeSeeded) {
      toast.info('Pick your pickup and drop-off to finish booking.');
    }
  };

  const handleTrack = () => {
    // Seed the store + warm getBooking on the SAME tap so TrackingScreen paints
    // from cache instead of a skeleton (the sheet holds the full booking, which
    // list/notification entries otherwise never seed into the store). (P2)
    warmTracking(booking);
    onClose();
    router.push(`/(customer)/tracking/${booking.id}`);
  };

  // A cancelled / unmatched errand is a money OUTCOME, not a bill: the fare
  // breakdown below is what the errand WOULD have cost, and rendering it
  // (plus the full total in the hero) told a customer whose ₱480 had already
  // been refunded that they paid ₱500 for nothing. Swap in what actually
  // happened instead.
  const isMoneyOutcome =
    booking.status === 'cancelled' || booking.status === 'no_runner';
  const money = bookingMoneyOutcome(booking);
  const heroCaption = isMoneyOutcome
    ? money.refunded != null && money.refunded > 0
      ? `${formatCurrency(money.refunded)} came back to your wallet`
      : money.fee > 0
        ? 'Kept as a cancellation fee'
        : 'Nothing was charged'
    : null;

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
          {heroCaption ? (
            <Text className="text-[11px] font-montserrat-semi text-textTertiary mt-0.5">
              {heroCaption}
            </Text>
          ) : null}
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

        {/* ── Payment — a bill while the errand stands, the money outcome
            once it was cancelled or never matched. ── */}
        <Eyebrow className="mb-2">{isMoneyOutcome ? 'What it cost' : 'Payment'}</Eyebrow>
        <View className="mb-5">
          {isMoneyOutcome ? (
            <View className="bg-surfaceMuted rounded-2xl p-4">
              {money.moneyMoved ? (
                <>
                  <View className="flex-row items-center justify-between mb-1.5">
                    <Text className="text-[13px] font-montserrat text-textSecondary">
                      Errand total
                    </Text>
                    <Text className="text-[13px] font-inter text-textSecondary tabular-nums">
                      {formatCurrency(booking.total_amount)}
                    </Text>
                  </View>
                  {money.fee > 0 ? (
                    <View className="flex-row items-center justify-between mb-1.5">
                      <Text className="text-[13px] font-montserrat text-textSecondary">
                        Cancellation fee
                      </Text>
                      <Text
                        className="text-[13px] font-inter tabular-nums"
                        style={{ color: LightColors.dangerDark }}
                      >
                        −{formatCurrency(money.fee)}
                      </Text>
                    </View>
                  ) : null}
                  <View className="h-px bg-divider my-2" />
                  <View className="flex-row items-center justify-between">
                    <Text className="text-[13px] font-montserrat-semi text-textPrimary flex-1 pr-3">
                      {money.refunded != null && money.refunded > 0
                        ? 'Refunded to your ErrandGuy wallet'
                        : 'Refunded'}
                    </Text>
                    <Text
                      className="text-[15px] font-inter-semi tabular-nums"
                      style={{
                        color:
                          money.refunded != null && money.refunded > 0
                            ? LightColors.successDark
                            : LightColors.textSecondary,
                      }}
                    >
                      {formatCurrency(money.refunded ?? 0)}
                    </Text>
                  </View>
                </>
              ) : (
                <Text className="text-[13px] font-montserrat text-textSecondary">
                  Nothing was charged for this errand.
                </Text>
              )}
              {booking.cancellation_reason ? (
                <Text className="text-[12px] font-montserrat text-textTertiary mt-3">
                  Reason: {booking.cancellation_reason}
                </Text>
              ) : null}
            </View>
          ) : (
            <PriceBreakdown items={priceItems} total={booking.total_amount} />
          )}
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
                  accessibilityHint="Starts a new booking pre-filled from this one"
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
