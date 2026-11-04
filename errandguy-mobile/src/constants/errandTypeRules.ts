/**
 * Per-errand-type UX rules.
 *
 * Different services have different real-world requirements: a shopping run
 * shouldn't ask for "estimated item value", and a queue job has no drop-off.
 * This file centralizes those per-type variations so the booking flow
 * adapts instead of forcing one generic form on every errand.
 *
 * The server offers four types — delivery, purchase ("Buy for me"), queue and
 * custom. Slugs of the types retired at launch still arrive on older bookings;
 * see LEGACY_SLUG_ALIASES below.
 */

export type VehicleKey = 'walk' | 'bicycle' | 'motorcycle' | 'car';

/** The title, search placeholder and confirm button of one map step. */
export interface MapStepCopy {
  title: string;
  search: string;
  confirm: string;
}

export interface ErrandTypeRule {
  /** Show "What do you need done?" / item description field. */
  showDescription: boolean;
  /** Description input is required (not just optional). */
  descriptionRequired: boolean;
  /** Label shown above the description input. */
  descriptionLabel: string;
  /** Placeholder shown inside the description input. */
  descriptionPlaceholder: string;
  /** Show item photos uploader. */
  showPhotos: boolean;
  /** Show estimated item value input. */
  showItemValue: boolean;
  /** Show "Add pickup contact" toggle. */
  showPickupContact: boolean;
  /** Show "Add dropoff contact" toggle. */
  showDropoffContact: boolean;
  /** Label used in the bottom card / route strip for the pickup point. */
  pickupLabel: string;
  /** Label used in the bottom card / route strip for the dropoff point. */
  dropoffLabel: string;
  /**
   * Map-step wording for the pickup / drop-off point, where "Set / Search /
   * Confirm <label>" reads wrong ("Confirm Buy from", "Set deliver to").
   */
  pickupStepCopy?: MapStepCopy;
  dropoffStepCopy?: MapStepCopy;
  /**
   * The map step that starts on the customer's current location. Most errands
   * start where the customer is; a shopping run starts at a store and ends at
   * their door.
   */
  currentLocationLeg: 'pickup' | 'dropoff';
  /** Vehicle types this errand can be fulfilled with. */
  allowedVehicles: VehicleKey[];
  /** Preferred default vehicle when the user opens Review. */
  defaultVehicle: VehicleKey;
  /** Optional helper note rendered at the top of the details sheet. */
  helperNote?: string;
  /**
   * The errand is completed at a single location (no separate dropoff),
   * e.g. waiting in a queue.
   */
  singleLocation: boolean;
  /**
   * Runner buys items on the customer's behalf and the final cost is
   * unknown up front. Surfaces a "shopping budget" input: the most the
   * runner may spend. The runner pays at the store and the customer repays
   * the receipt amount in cash at the door; nothing for items is charged
   * online.
   */
  requiresShoppingBudget: boolean;
  /**
   * Ordered list of statuses this errand passes through, from accepted
   * to completed. Single-location errands skip in_transit / dropoff /
   * delivered stages because they finish at the same place.
   */
  statusFlow: BookingStatusKey[];
  /**
   * Human-readable button label for the runner's action button at each
   * status. Worded per errand type so "Pick up item" doesn't appear on a
   * queueing job.
   */
  statusActions: Partial<Record<BookingStatusKey, string>>;
}

/** Statuses runners can transition through (subset of BookingStatus). */
export type BookingStatusKey =
  | 'accepted'
  | 'heading_to_pickup'
  | 'arrived_at_pickup'
  | 'picked_up'
  | 'in_transit'
  | 'arrived_at_dropoff'
  | 'delivered'
  | 'completed';

const STANDARD_FLOW: BookingStatusKey[] = [
  'accepted',
  'heading_to_pickup',
  'arrived_at_pickup',
  'picked_up',
  'in_transit',
  'arrived_at_dropoff',
  'delivered',
  'completed',
];

/** Single-location: runner travels to the spot, performs the action, done. */
const SINGLE_LOCATION_FLOW: BookingStatusKey[] = [
  'accepted',
  'heading_to_pickup',
  'arrived_at_pickup',
  'picked_up',
  'completed',
];

const STANDARD_ACTIONS: Partial<Record<BookingStatusKey, string>> = {
  accepted: 'Head to pickup',
  heading_to_pickup: 'I\u2019ve arrived',
  arrived_at_pickup: 'Pick up item',
  picked_up: 'Start delivery',
  in_transit: 'Arrived at drop-off',
  arrived_at_dropoff: 'Hand over item',
  delivered: 'Complete errand',
};

const DEFAULT_RULE: ErrandTypeRule = {
  showDescription: true,
  descriptionRequired: false,
  descriptionLabel: 'What do you need done?',
  descriptionPlaceholder: 'Describe your errand...',
  showPhotos: true,
  showItemValue: true,
  showPickupContact: true,
  showDropoffContact: true,
  pickupLabel: 'Pickup',
  // "Drop-off", hyphenated — the spelling STATUS_LABELS and every customer
  // surface uses. This default was the one place it rendered as "Dropoff".
  dropoffLabel: 'Drop-off',
  currentLocationLeg: 'pickup',
  allowedVehicles: ['walk', 'bicycle', 'motorcycle', 'car'],
  defaultVehicle: 'motorcycle',
  singleLocation: false,
  requiresShoppingBudget: false,
  statusFlow: STANDARD_FLOW,
  statusActions: STANDARD_ACTIONS,
};

const RULES: Record<string, Partial<ErrandTypeRule>> = {
  delivery: {
    descriptionLabel: 'Item description',
    descriptionPlaceholder: 'What is being delivered? (size, fragility, etc.)',
    descriptionRequired: true,
  },

  queue: {
    descriptionLabel: 'What is the runner queuing for?',
    descriptionPlaceholder: 'Place + purpose (e.g. "DFA Pasay — passport claim, 9am slot")',
    descriptionRequired: true,
    showPhotos: false,
    showItemValue: false,
    // The runner waits in line at one location; no dropoff is involved.
    singleLocation: true,
    pickupLabel: 'Queue location',
    dropoffLabel: 'Queue location',
    showDropoffContact: false,
    // There is no trip to make faster, and Review hides the vehicle picker
    // here, so the cheapest option is the only honest one: a motorcycle would
    // add its premium and leave the errand to motorcycle and car runners only.
    allowedVehicles: ['walk'],
    defaultVehicle: 'walk',
    statusFlow: SINGLE_LOCATION_FLOW,
    statusActions: {
      accepted: 'Head to queue location',
      heading_to_pickup: 'I’m in line',
      arrived_at_pickup: 'My turn — finishing up',
      picked_up: 'Mark as completed',
    },
    helperNote: 'Fixed price. No extra charge for waiting time.',
  },

  purchase: {
    descriptionLabel: 'What should the runner buy?',
    descriptionPlaceholder: 'Item name, brand, size, store preference, alternatives...',
    descriptionRequired: true,
    pickupLabel: 'Store',
    dropoffLabel: 'Deliver to',
    pickupStepCopy: {
      title: 'Which store?',
      search: 'Search for a store',
      confirm: 'Confirm store',
    },
    dropoffStepCopy: {
      title: 'Where to deliver?',
      search: 'Search for an address',
      confirm: 'Confirm drop-off',
    },
    currentLocationLeg: 'dropoff',
    showItemValue: false,
    showPickupContact: false,
    requiresShoppingBudget: true,
    statusActions: {
      ...STANDARD_ACTIONS,
      arrived_at_pickup: 'Buy item + capture receipt',
      picked_up: 'Start delivery',
      arrived_at_dropoff: 'Hand over item',
    },
    helperNote:
      'Your runner pays for the items with their own cash, up to the budget you set. Have cash ready to repay the receipt amount when they arrive.',
  },

  custom: {
    descriptionLabel: 'Describe your errand',
    descriptionPlaceholder: 'Tell the runner exactly what you need done...',
    descriptionRequired: true,
  },

  // LEGACY — bills payment is retired and can no longer be booked. It is kept
  // only so a bill errand already in progress when this build lands can still
  // be finished: it ends at the payment counter (no drop-off leg), and the
  // runner pays against the customer's budget and uploads the receipt. The
  // booking-form fields are gone because nothing books it any more.
  bills_payment: {
    singleLocation: true,
    pickupLabel: 'Payment center',
    dropoffLabel: 'Payment center',
    showDropoffContact: false,
    requiresShoppingBudget: true,
    statusFlow: SINGLE_LOCATION_FLOW,
    statusActions: {
      accepted: 'Head to payment center',
      heading_to_pickup: 'I’ve arrived',
      arrived_at_pickup: 'Pay bill + capture receipt',
      picked_up: 'Mark as completed',
    },
  },
};

/**
 * Retired errand types that now run on the rule of a current one.
 *
 * The server stopped offering these at launch, but bookings made before the
 * cut keep their slug, and one can still be in progress when this build
 * lands. Each finishes on the ladder of the type that absorbed it:
 *   - food / grocery → purchase: the shopping flow (budget, receipt).
 *   - document / laundry → delivery.
 *   - transportation → delivery. Passenger rides are gone; a ride still in
 *     progress simply follows the normal delivery steps.
 * bills_payment has no current equivalent, so it keeps its own legacy rule
 * above.
 */
const LEGACY_SLUG_ALIASES: Record<string, string> = {
  food: 'purchase',
  grocery: 'purchase',
  document: 'delivery',
  laundry: 'delivery',
  transportation: 'delivery',
};

/** Every slug the server no longer offers for new bookings. */
export const RETIRED_ERRAND_SLUGS: readonly string[] = [
  ...Object.keys(LEGACY_SLUG_ALIASES),
  'bills_payment',
];

/** True when a slug names a type that can no longer be booked. */
export function isRetiredErrandSlug(slug?: string | null): boolean {
  return !!slug && RETIRED_ERRAND_SLUGS.includes(slug);
}

export function getErrandTypeRule(slug?: string | null): ErrandTypeRule {
  if (!slug) return DEFAULT_RULE;
  const override = RULES[LEGACY_SLUG_ALIASES[slug] ?? slug];
  if (!override) return DEFAULT_RULE;
  return { ...DEFAULT_RULE, ...override };
}

export const DEFAULT_ERRAND_TYPE_RULE = DEFAULT_RULE;

/**
 * The vehicle a booking is priced and matched on. A single-location errand
 * hides the vehicle picker, so it always gets its type's default: a restored
 * draft or a rebook can't carry an older pick (and its premium) in unseen.
 */
export function bookingVehicle(rule: ErrandTypeRule, stored?: string | null): VehicleKey {
  if (!rule.singleLocation && stored && rule.allowedVehicles.includes(stored as VehicleKey)) {
    return stored as VehicleKey;
  }
  return rule.defaultVehicle;
}

/**
 * The vehicles Review may offer, once the fare estimate is in.
 *
 * `allowedVehicles` is the app's own list per errand type, but staff can
 * withdraw a vehicle for a type from the admin panel (a per-km rate of 0). The
 * estimate then leaves it out of `vehicle_types` and gives it no price, and
 * creating the booking refuses it — so offering it from the app's list alone
 * showed "₱0.00" or a fare the server would never take. Once the estimate has
 * loaded this is the app's list cut down to what the server offers AND priced.
 *
 * Unchanged from before while the estimate is still loading (or failed), and
 * on an older server that sends no `vehicle_types` (only the price check
 * applies then). A single-location errand (queue) keeps its own list exactly:
 * it hides the picker and always books its default.
 */
export function offeredVehicles(
  rule: ErrandTypeRule,
  estimate: Record<string, unknown> | null | undefined,
): VehicleKey[] {
  if (rule.singleLocation || !estimate) return rule.allowedVehicles;
  const served = Array.isArray(estimate.vehicle_types) ? (estimate.vehicle_types as unknown[]) : null;
  return rule.allowedVehicles.filter((key) => {
    if (served && !served.includes(key)) return false;
    const price = estimate[key] as { total_amount?: unknown } | null | undefined;
    const total = Number(price?.total_amount);
    return Number.isFinite(total) && total > 0;
  });
}

/**
 * Where the selection goes when the vehicle picked is no longer offered: the
 * type's default when that is still offered (the same place a changed errand
 * type snaps back to), else the first one offered. Null only when nothing is
 * offered at all.
 */
export function vehicleWithinOffer(
  rule: ErrandTypeRule,
  selected: string,
  offered: VehicleKey[],
): VehicleKey | null {
  if (offered.includes(selected as VehicleKey)) return selected as VehicleKey;
  if (offered.includes(rule.defaultVehicle)) return rule.defaultVehicle;
  return offered[0] ?? null;
}

/**
 * Every slug with a rule override, in declaration order (the four current
 * types, then the legacy bills_payment rule; aliased slugs reuse these).
 *
 * Exported so the arch guards in
 * `components/runner/__tests__/statusActionTransitions.test.ts` can sweep EVERY
 * ladder rather than a hand-maintained list — that sweep is what catches a new
 * errand type reintroducing a state-noun button label or the opposite tense for
 * a transition every other ladder already names.
 */
export const ERRAND_TYPE_SLUGS = Object.keys(RULES);
