import type { BookingStatus } from '../types';
import { LightColors } from './colors';
import { getErrandTypeRule } from './errandTypeRules';

/**
 * Terse status vocabulary — chips, pills, timeline steps, screen-reader
 * announcements. THE base map: everything else in this file layers on top of
 * it, and any status without a per-type override renders exactly this.
 *
 * Sentence case, matching the convention `constants/copy.ts` declares and the
 * backend push titles (`SendBookingStatusNotification::TEMPLATES`). The map
 * used to be Title Case, so one errand's `in_transit` arrived as "In transit"
 * in the Alerts inbox and rendered as "In Transit" on the row the alert
 * deep-links into.
 *
 * `no_runner` is pinned to the singular "No runner available" — the wording
 * the push, the tracking hero and the public trip page all use. It had seven
 * spellings across the app, including a singular/plural flip on the one screen
 * where the customer has to decide whether to rebook.
 */
export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Finding a runner',
  matched: 'Runner matched',
  accepted: 'Runner accepted',
  heading_to_pickup: 'Heading to pickup',
  arrived_at_pickup: 'Arrived at pickup',
  picked_up: 'Picked up',
  in_transit: 'In transit',
  arrived_at_dropoff: 'Arrived at drop-off',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_runner: 'No runner available',
};

/**
 * Per-errand-type corrections to the terse vocabulary, keyed by errand_type
 * slug. Only statuses whose BASE label is factually WRONG for that flow are
 * listed — a queue errand has no parcel to have "Picked up". Everything else
 * falls through to STATUS_LABELS on purpose, so this stays a correction table
 * and not a second copy of the vocabulary.
 *
 * Wording is taken from the two surfaces that already got this right (the
 * customer tracking hero and the backend's TYPE_OVERRIDES push copy) rather
 * than invented here, so the chip, the hero and the push agree.
 */
const TYPE_STATUS_LABELS: Record<string, Partial<Record<BookingStatus, string>>> = {
  // Single-location: the runner queues. `picked_up` is the flow's "work done"
  // step, not a handover.
  queue: {
    arrived_at_pickup: 'In line',
    picked_up: 'At the front',
  },
};

/**
 * The same correction for any OTHER single-location flow (today only a legacy
 * bill payment still in progress — see errandTypeRules): it finishes where it
 * starts, so there is nothing to have "Picked up".
 */
const SINGLE_LOCATION_LABELS: Partial<Record<BookingStatus, string>> = {
  arrived_at_pickup: 'On site',
  picked_up: 'Task done',
};

/**
 * The single terse status label for a booking — type-aware.
 *
 * Prefer this over indexing STATUS_LABELS directly: passing the errand type
 * slug is what keeps a queue row from claiming an item was picked up. With no
 * slug (or an unmapped one) it returns the base label unchanged, so it is a
 * safe drop-in everywhere.
 */
export function statusLabel(
  status: BookingStatus | string,
  errandSlug?: string | null,
): string {
  const s = status as BookingStatus;
  const override = errandSlug
    ? TYPE_STATUS_LABELS[errandSlug]?.[s] ??
      (getErrandTypeRule(errandSlug).singleLocation ? SINGLE_LOCATION_LABELS[s] : undefined)
    : undefined;
  return override ?? STATUS_LABELS[s] ?? String(status);
}

/**
 * Conversational, customer-facing headline for a booking status — the
 * register the home "your errand" card and the tracking hero speak in
 * ("Ana is on the way to you"), as opposed to the terse chip register above.
 *
 * Kept HERE rather than inside the card so the home card, the tracking hero
 * and anything else narrating a live errand cannot drift apart again; the
 * runner's first name is threaded through because naming the person is the
 * whole point of this register.
 */
export function statusHeadline(
  status: BookingStatus | string,
  opts: { errandSlug?: string | null; runnerFirstName?: string | null } = {},
): string {
  const s = status as BookingStatus;
  // "Runner" as the fallback subject so the sentence still reads when the
  // payload has no runner attached yet.
  const name = opts.runnerFirstName ?? 'Runner';

  if (opts.errandSlug === 'queue') {
    switch (s) {
      case 'arrived_at_pickup':
        return `${name} is in line for you`;
      case 'picked_up':
        return `${name} reached the front of the line`;
      case 'delivered':
      case 'completed':
        return 'All done';
      default:
        break;
    }
  }

  // Any other single-location flow (see SINGLE_LOCATION_LABELS): no parcel,
  // no drop-off leg to narrate.
  if (opts.errandSlug && getErrandTypeRule(opts.errandSlug).singleLocation) {
    switch (s) {
      case 'arrived_at_pickup':
        return `${name} is on site`;
      case 'picked_up':
        return `${name} is wrapping up`;
      case 'delivered':
      case 'completed':
        return 'All done';
      default:
        break;
    }
  }

  switch (s) {
    case 'pending':
      return 'Looking for a runner nearby…';
    case 'no_runner':
      // Terminal (no runner was found) — no "yet"; it isn't still trying.
      return 'No runner available';
    case 'matched':
      return `${name} matched — confirming…`;
    case 'accepted':
      return `${name} is on the way`;
    case 'heading_to_pickup':
      return `${name} is heading to pickup`;
    case 'arrived_at_pickup':
      return `${name} arrived at pickup`;
    case 'picked_up':
      return `${name} picked up your item`;
    case 'in_transit':
      // "…on the way to you", never "en route": same phrasing as the
      // tracking hero for the identical status.
      return `${name} is on the way to you`;
    case 'arrived_at_dropoff':
      return `${name} arrived at drop-off`;
    case 'delivered':
      return 'Delivered — confirm to complete';
    case 'completed':
      return 'Errand completed';
    case 'cancelled':
      return 'Errand cancelled';
    default:
      return statusLabel(s, opts.errandSlug);
  }
}

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
