import type { BookingStatus } from '../types';
import { LightColors } from './colors';

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Finding a Runner',
  matched: 'Runner Matched',
  accepted: 'Runner Accepted',
  heading_to_pickup: 'Heading to Pickup',
  arrived_at_pickup: 'Arrived at Pickup',
  picked_up: 'Picked Up',
  in_transit: 'In Transit',
  arrived_at_dropoff: 'Arrived at Drop-off',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_runner: 'No Runner Available',
};

/**
 * Status FILL colors — dots, badges, progress tracks, borders.
 *
 * Convention (mirrors src/constants/colors.ts): the base status tones are
 * for FILLS/GLYPHS only; status TEXT below ~17px must use the *Dark rungs
 * in STATUS_TEXT_COLORS below or it falls under the 4.5:1 AA floor.
 */
export const STATUS_COLORS: Record<BookingStatus, string> = {
  pending: LightColors.warning,
  matched: LightColors.primary,
  accepted: LightColors.primary,
  heading_to_pickup: LightColors.primary500,
  arrived_at_pickup: LightColors.primary500,
  picked_up: LightColors.primary500,
  in_transit: LightColors.primary500,
  arrived_at_dropoff: LightColors.primary500,
  delivered: LightColors.success,
  completed: LightColors.success,
  cancelled: LightColors.danger,
  no_runner: LightColors.textMuted, // matches textMuted so grays stay on one ramp
};

/**
 * Status TEXT colors — the AA-safe rungs for status copy below ~17px on
 * white/soft washes. Pair with STATUS_COLORS: fill takes the base tone,
 * text takes this. primary (#2563EB) already passes 4.5:1 so every live
 * blue status keeps the core brand blue.
 */
export const STATUS_TEXT_COLORS: Record<BookingStatus, string> = {
  pending: LightColors.warningDark,
  matched: LightColors.primary,
  accepted: LightColors.primary,
  heading_to_pickup: LightColors.primary,
  arrived_at_pickup: LightColors.primary,
  picked_up: LightColors.primary,
  in_transit: LightColors.primary,
  arrived_at_dropoff: LightColors.primary,
  delivered: LightColors.successDark,
  completed: LightColors.successDark,
  cancelled: LightColors.dangerDark,
  no_runner: LightColors.textSecondary,
};

/** Statuses with a live journey to follow — feeds "Track" / live-tracking
 *  CTAs so screens stop hand-rolling their own status lists. */
export const TRACKABLE_STATUSES: BookingStatus[] = [
  'pending',
  'matched',
  'accepted',
  'heading_to_pickup',
  'arrived_at_pickup',
  'picked_up',
  'in_transit',
  'arrived_at_dropoff',
];
