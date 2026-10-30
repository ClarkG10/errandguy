import React from 'react';
import { View, Text } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import {
  Banknote,
  Bike,
  CalendarClock,
  Car,
  Wallet,
  PersonStanding,
  Route,
} from 'lucide-react-native';
import { formatCurrency } from '../../utils/formatCurrency';
import {
  bookedVehicleLabel,
  extraStopCount,
  paymentMethodLabel,
  readAmountToCollect,
  readBookedVehicle,
  readPaymentMethodType,
  scheduledOfferLabel,
  type BookedVehicle,
} from './offerMeta';
import type { Booking } from '../../types';
import { LightColors } from '../../constants/colors';

/**
 * Small fact chips for the runner's offer modal — one decision-critical fact
 * each, so a 90-second decision reads at a glance.
 */
export function OfferChip({
  Icon,
  label,
  bg,
  fg,
  borderColor,
}: {
  Icon: LucideIcon;
  label: string;
  bg: string;
  fg: string;
  borderColor?: string;
}) {
  return (
    <View
      // Layout lives in className (NativeWind drops flexDirection when a
      // component is styled through `style` alone).
      className="flex-row items-center gap-1 rounded-full px-2.5 py-1"
      style={{
        backgroundColor: bg,
        borderWidth: borderColor ? 1 : 0,
        borderColor,
      }}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <Icon size={13} color={fg} strokeWidth={2} />
      <Text className="text-[12px] font-montserrat-bold" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * How this job settles, and how much (if any) money the runner handles in
 * person. Cash jobs get the brand-gold `accent` money treatment (never
 * `warning` — that rung means caution); prepaid jobs stay neutral.
 *
 * Renders nothing when the payload carries no payment metadata at all (an
 * offer that arrived over the Reverb projection, or a stale cache entry) —
 * a wrong guess here sends a runner to a doorstep expecting the wrong thing.
 */
export function PaymentChip({ booking }: { booking: Booking }) {
  const type = readPaymentMethodType(booking);
  const collect = readAmountToCollect(booking);
  const label = paymentMethodLabel(type);

  if (collect != null) {
    return (
      <OfferChip
        Icon={Banknote}
        label={`Collect ${formatCurrency(collect)}`}
        bg={LightColors.accentSoft}
        fg={LightColors.accentDark}
        borderColor={LightColors.accentStrong}
      />
    );
  }

  if (!label) return null;

  return (
    <OfferChip
      Icon={type === 'cash' ? Banknote : Wallet}
      label={type === 'cash' ? 'Cash' : `Prepaid · ${label}`}
      bg={LightColors.surfaceMuted}
      fg={LightColors.textSecondary}
    />
  );
}

/** "Scheduled · today 3:00 PM" — absent for immediate bookings. */
export function ScheduledChip({ booking }: { booking: Booking }) {
  const label = scheduledOfferLabel(booking);
  if (!label) return null;
  return (
    <OfferChip
      Icon={CalendarClock}
      label={label}
      bg={LightColors.primarySoft}
      fg={LightColors.primaryDark}
    />
  );
}

// Same glyphs as the runner's own vehicle settings (no motorcycle glyph in
// lucide, so the two-wheelers share Bike and the label disambiguates).
const VEHICLE_ICONS: Record<BookedVehicle, LucideIcon> = {
  walk: PersonStanding,
  bicycle: Bike,
  motorcycle: Bike,
  car: Car,
};

/**
 * "Car booked" — the vehicle the customer chose, and so the one the fare was
 * priced for. Renders nothing when the payload names no known vehicle.
 */
export function VehicleChip({ booking }: { booking: Booking }) {
  const vehicle = readBookedVehicle(booking);
  const label = bookedVehicleLabel(booking);
  if (!vehicle || !label) return null;
  return (
    <OfferChip
      Icon={VEHICLE_ICONS[vehicle]}
      label={label}
      bg={LightColors.surfaceMuted}
      fg={LightColors.textSecondary}
    />
  );
}

/** "+2 more stops" — a 3-stop job must not look identical to a 1-stop job. */
export function StopsChip({ booking }: { booking: Booking }) {
  const extra = extraStopCount(booking);
  if (extra <= 0) return null;
  return (
    <OfferChip
      Icon={Route}
      label={`+${extra} more stop${extra > 1 ? 's' : ''}`}
      bg={LightColors.surfaceMuted}
      fg={LightColors.textSecondary}
    />
  );
}
