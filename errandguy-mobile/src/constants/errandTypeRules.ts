/**
 * Per-errand-type UX rules.
 *
 * Different services have different real-world requirements: a passenger
 * ride doesn't need item photos, a food run shouldn't ask for "estimated
 * item value", and walking is not a valid vehicle for transportation.
 * This file centralizes those per-type variations so the booking flow
 * adapts instead of forcing one generic form on every errand.
 */

export type VehicleKey = 'walk' | 'bicycle' | 'motorcycle' | 'car';

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
  /** Vehicle types this errand can be fulfilled with. */
  allowedVehicles: VehicleKey[];
  /** Preferred default vehicle when the user opens Review. */
  defaultVehicle: VehicleKey;
  /** Optional helper note rendered at the top of the details sheet. */
  helperNote?: string;
  /**
   * The errand is completed at a single location (no separate dropoff).
   * Examples: bills payment, queue/line waiting, document filing on-site.
   */
  singleLocation: boolean;
  /**
   * Runner buys items on the customer's behalf and the final cost is
   * unknown up front. Surfaces a "shopping budget" input the customer
   * pre-authorizes; the runner reconciles the actual cost with a receipt
   * at completion.
   */
  requiresShoppingBudget: boolean;
  /**
   * Ordered list of statuses this errand passes through, from accepted
   * to completed. Single-location errands skip in_transit / dropoff /
   * delivered stages because they finish at the same place. Transportation
   * skips the "delivered" stage because there is no parcel handover.
   */
  statusFlow: BookingStatusKey[];
  /**
   * Human-readable button label for the runner's action button at each
   * status. Worded per errand type so "Pick Up Item" doesn't appear on a
   * passenger ride or a queueing job.
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

const TRANSPORT_FLOW: BookingStatusKey[] = [
  'accepted',
  'heading_to_pickup',
  'arrived_at_pickup',
  'picked_up',
  'in_transit',
  'arrived_at_dropoff',
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

  grocery: {
    descriptionLabel: 'Grocery list',
    descriptionPlaceholder: 'List the items to buy (qty, brand, notes)...',
    descriptionRequired: true,
    pickupLabel: 'Store',
    dropoffLabel: 'Deliver to',
    showItemValue: false,
    // Pickup contact is the store — usually not needed.
    showPickupContact: false,
    requiresShoppingBudget: true,
    statusActions: {
      ...STANDARD_ACTIONS,
      arrived_at_pickup: 'Confirm purchase + receipt',
      picked_up: 'Start delivery',
      arrived_at_dropoff: 'Hand over groceries',
    },
    helperNote:
      'Set a shopping budget — your runner will only spend up to this amount on groceries. The exact cost is reconciled with a receipt at completion.',
  },

  food: {
    descriptionLabel: 'Order details',
    descriptionPlaceholder: 'Restaurant + items (e.g. Jollibee — 2x Chickenjoy w/ rice)',
    descriptionRequired: true,
    pickupLabel: 'Restaurant',
    dropoffLabel: 'Deliver to',
    showItemValue: false,
    showPickupContact: false,
    // Walking with hot food is unusual; bikes/motorcycles/cars are normal.
    allowedVehicles: ['bicycle', 'motorcycle', 'car'],
    defaultVehicle: 'motorcycle',
    requiresShoppingBudget: true,
    statusActions: {
      ...STANDARD_ACTIONS,
      arrived_at_pickup: 'Confirm order + receipt',
      picked_up: 'Start delivery',
      arrived_at_dropoff: 'Hand over food',
    },
    helperNote:
      'Set a budget for the food — your runner can only spend up to this amount. Once the order is placed it cannot be cancelled. The actual cost is reconciled with a receipt.',
  },

  document: {
    descriptionLabel: 'Document description',
    descriptionPlaceholder: 'What document needs to be sent or claimed?',
    descriptionRequired: true,
    // Documents are usually low-value and don't need photos.
    showPhotos: false,
    showItemValue: false,
    statusActions: {
      ...STANDARD_ACTIONS,
      arrived_at_pickup: 'Pick up document',
      arrived_at_dropoff: 'Submit document',
    },
  },

  laundry: {
    descriptionLabel: 'Laundry notes',
    descriptionPlaceholder: 'Number of bags, special handling, shop preference...',
    pickupLabel: 'Pick up from',
    dropoffLabel: 'Drop off at',
    showItemValue: false,
  },

  transportation: {
    // Customer IS the passenger — no item description, photos, or value.
    showDescription: true,
    descriptionRequired: false,
    descriptionLabel: 'Notes for driver (optional)',
    descriptionPlaceholder: 'e.g. "Wait at the lobby", landmarks, luggage info',
    showPhotos: false,
    showItemValue: false,
    // Customer is the contact at both ends; no separate pickup/dropoff person.
    showPickupContact: false,
    showDropoffContact: false,
    pickupLabel: 'Pick me up at',
    dropoffLabel: 'Take me to',
    // Per spec: transportation only available for motorcycle and car.
    allowedVehicles: ['motorcycle', 'car'],
    defaultVehicle: 'motorcycle',
    statusFlow: TRANSPORT_FLOW,
    statusActions: {
      accepted: 'Head to passenger',
      heading_to_pickup: 'I’ve arrived',
      arrived_at_pickup: 'Start ride',
      // Every other ladder names the action the runner is ABOUT TO PERFORM.
      // These two used to break that: `picked_up` read "In transit" (a status
      // noun — the driver couldn't tell whether it described their state or
      // offered to change it) and `in_transit` read "Arriving at drop-off"
      // (present participle) where the standard ladder's identical transition
      // reads "Arrived at drop-off" (past), teaching two contradictory
      // meanings for the button tapped at the moment the driver pulls up.
      picked_up: 'Start the trip',
      in_transit: 'Arrived at drop-off',
      arrived_at_dropoff: 'Complete ride',
    },
    helperNote: 'You will receive a 4-digit PIN to share with your driver before boarding.',
  },

  bills_payment: {
    descriptionLabel: 'Bill details',
    descriptionPlaceholder: 'Biller (e.g. Meralco), account number, reference, amount due',
    descriptionRequired: true,
    showPhotos: true, // bill stub photo helps the runner
    showItemValue: false,
    showDropoffContact: false,
    // Done at a single payment center — no dropoff.
    singleLocation: true,
    pickupLabel: 'Payment center',
    dropoffLabel: 'Payment center',
    requiresShoppingBudget: true,
    statusFlow: SINGLE_LOCATION_FLOW,
    statusActions: {
      accepted: 'Head to payment center',
      heading_to_pickup: 'I’ve arrived',
      arrived_at_pickup: 'Pay bill + capture receipt',
      picked_up: 'Mark as completed',
    },
    helperNote:
      'Set a budget covering the bill amount + service fees. Your runner will pay on your behalf and upload the receipt.',
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
    statusFlow: SINGLE_LOCATION_FLOW,
    statusActions: {
      accepted: 'Head to queue location',
      heading_to_pickup: 'I’m in line',
      arrived_at_pickup: 'My turn — finishing up',
      picked_up: 'Mark as completed',
    },
    helperNote:
      'Pricing is based on travel; you will pay the runner separately for the actual waiting time once they arrive.',
  },

  purchase: {
    descriptionLabel: 'What should the runner buy?',
    descriptionPlaceholder: 'Item name, brand, size, store preference, alternatives...',
    descriptionRequired: true,
    pickupLabel: 'Buy from',
    dropoffLabel: 'Deliver to',
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
      'Set a maximum budget — the runner will not exceed this. The exact cost is reconciled with a receipt at delivery.',
  },

  custom: {
    descriptionLabel: 'Describe your errand',
    descriptionPlaceholder: 'Tell the runner exactly what you need done...',
    descriptionRequired: true,
  },
};

export function getErrandTypeRule(slug?: string | null): ErrandTypeRule {
  if (!slug) return DEFAULT_RULE;
  const override = RULES[slug];
  if (!override) return DEFAULT_RULE;
  return { ...DEFAULT_RULE, ...override };
}

export const DEFAULT_ERRAND_TYPE_RULE = DEFAULT_RULE;

/**
 * Every slug with a rule override, in declaration order.
 *
 * Exported so the arch guards in
 * `components/runner/__tests__/statusActionTransitions.test.ts` can sweep EVERY
 * ladder rather than a hand-maintained list — that sweep is what catches a new
 * errand type reintroducing a state-noun button label or the opposite tense for
 * a transition every other ladder already names.
 */
export const ERRAND_TYPE_SLUGS = Object.keys(RULES);
