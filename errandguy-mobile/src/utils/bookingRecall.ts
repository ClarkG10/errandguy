import type { Booking, ChecklistItem, PricingMode } from '../types/booking';
import type { VehicleKey } from '../constants/errandTypeRules';
import { parseChecklist } from './shoppingChecklist';
import { formatCurrency } from './formatCurrency';

/**
 * "Same as last time" — per-errand-type recall from the customer's own
 * booking history.
 *
 * A repeat customer retypes the SAME required content on every booking: the
 * Meralco account number on a monthly bills payment, the eight-row weekly
 * grocery list plus its budget, the same gate note. All of it is already on
 * their past bookings and already cached on the device under the
 * ['bookings','recent',userId] key the Home screen renders.
 *
 * Recall is deliberately scoped PER ERRAND TYPE. A grocery list and a
 * bills-payment reference have nothing in common, so the global "Repeat last"
 * shortcut (which clones whichever booking happened to be most recent) is
 * useless the moment a customer alternates between two services.
 *
 * Nothing here writes anything. These are pure functions over a list of
 * bookings; the caller decides when to apply the result, and the values must
 * land in VISIBLE inputs so the customer sees and can edit what was recalled
 * before it is ever submitted. (`shopping_budget` in particular is a spend
 * authorisation — it must never be a hidden draft value.)
 *
 * Kept RN-free (like `shoppingChecklist`) so it stays trivially unit-testable.
 */

/** The draft fields a recall may fill. Every one is optional and editable. */
export interface RecallFields {
  description?: string;
  shoppingItems?: ChecklistItem[];
  shopping_budget?: number;
  special_instructions?: string;
  /** Only ever a vehicle the CURRENT type's rule still allows. */
  vehicle_type_rate?: VehicleKey;
  pricing_mode?: PricingMode;
  /** Only recalled when it is provably >= the live minimum (see findRecall). */
  customer_offer?: number;
}

export interface BookingRecall {
  /** Booking the values came from — shown on the chip, never submitted. */
  sourceId: string;
  sourceCreatedAt: string;
  /** Errand type name for the chip label ("Same as last Grocery"). */
  typeName: string;
  fields: RecallFields;
  /** One-line human summary of exactly what a tap will fill in. */
  preview: string;
}

export interface FindRecallOptions {
  /** The type being booked. No id ⇒ no recall (never cross types). */
  errandTypeId?: string;
  /** rule.requiresShoppingBudget — drives checklist vs free-text recall. */
  requiresShoppingBudget: boolean;
  /** rule.showDescription — a type with no description field recalls none. */
  showDescription: boolean;
  /** rule.allowedVehicles — a remembered car can't survive onto a walk-only type. */
  allowedVehicles: VehicleKey[];
  /**
   * `min_negotiate_fee` from the live estimate for THIS booking, when known.
   * A remembered offer is recalled only when it clears the current floor;
   * otherwise it is dropped and Review seeds the floor itself. An offer under
   * the server minimum is a 422 at submit, not a convenience.
   */
  minNegotiateFee?: number;
}

/** Bookings whose content is a poor thing to hand back to the customer. */
const SKIPPED_STATUSES: ReadonlyArray<string> = ['cancelled'];

function cleanText(value: string | null | undefined, max: number): string | undefined {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

/** Positive, finite money only — a 0 or negative budget is not a recall. */
function cleanAmount(value: number | null | undefined): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Recover the checklist for a shopping errand.
 *
 * `shopping_items` is the server's structured list; older bookings predate it
 * and carry the list only as the serialized `description`, which
 * `parseChecklist` reads back. Ticks are dropped on purpose — a recalled list
 * is a fresh run, exactly as the "Repeat last" clone treats it.
 */
function recallChecklist(b: Booking): ChecklistItem[] | undefined {
  const fromServer = (b.shopping_items ?? [])
    .map((it, i) => ({
      id: it.id || `item-${i}`,
      name: (it.name ?? '').trim(),
      qty: Math.max(1, Math.floor(Number(it.qty) || 1)),
    }))
    .filter((it) => it.name.length > 0);
  if (fromServer.length > 0) return fromServer;

  const parsed = parseChecklist(b.description);
  if (parsed && parsed.items.length > 0) return parsed.items;
  return undefined;
}

const VEHICLE_LABELS: Record<VehicleKey, string> = {
  walk: 'On foot',
  bicycle: 'Bicycle',
  motorcycle: 'Motorcycle',
  car: 'Car',
};

/**
 * The one-line summary on the chip. It has to name EVERYTHING the tap will
 * apply, including the two things that only become visible two screens later
 * on Review (the vehicle and the pricing mode) — both move the price, so
 * neither may be applied without being shown here first. 'fixed' is the
 * standing default and is left out as noise.
 */
function buildPreview(fields: RecallFields, requiresShoppingBudget: boolean): string {
  const parts: string[] = [];
  if (requiresShoppingBudget) {
    const n = fields.shoppingItems?.length ?? 0;
    if (n > 0) parts.push(`${n} item${n === 1 ? '' : 's'}`);
    if (fields.shopping_budget != null) {
      parts.push(`budget ${formatCurrency(fields.shopping_budget)}`);
    }
  } else if (fields.description) {
    parts.push(fields.description.replace(/\s+/g, ' '));
  }
  if (fields.special_instructions) {
    parts.push(fields.special_instructions.replace(/\s+/g, ' '));
  }
  if (fields.vehicle_type_rate) {
    parts.push(VEHICLE_LABELS[fields.vehicle_type_rate]);
  }
  if (fields.pricing_mode === 'negotiate') {
    parts.push(
      fields.customer_offer != null
        ? `your offer ${formatCurrency(fields.customer_offer)}`
        : 'make an offer',
    );
  }
  return parts.join(' · ');
}

/**
 * The most recent booking of `errandTypeId` that actually carries something
 * worth filling in, or null.
 *
 * Ordering is re-derived from `created_at` rather than trusted from the caller
 * so a differently-sorted cache entry can't hand back a stale booking.
 */
export function findRecall(
  bookings: Booking[] | null | undefined,
  options: FindRecallOptions,
): BookingRecall | null {
  const { errandTypeId, requiresShoppingBudget, showDescription, allowedVehicles } = options;
  if (!errandTypeId || !Array.isArray(bookings) || bookings.length === 0) return null;

  const candidates = bookings
    .filter(
      (b) =>
        !!b &&
        b.errand_type_id === errandTypeId &&
        !SKIPPED_STATUSES.includes(b.status),
    )
    .sort(
      (a, b) =>
        new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
    );

  for (const b of candidates) {
    const fields: RecallFields = {};

    if (requiresShoppingBudget) {
      const items = recallChecklist(b);
      if (items) fields.shoppingItems = items;
      const budget = cleanAmount(b.shopping_budget);
      if (budget != null) fields.shopping_budget = budget;
      // `description` is DERIVED from the checklist at submit
      // (review.tsx → serializeChecklist), so recalling it too would only
      // plant a stale serialization that the next submit overwrites.
    } else if (showDescription) {
      // A description that is really a serialized checklist belongs to a
      // shopping type — never drop that raw text into a free-text field.
      const isSerializedList = parseChecklist(b.description) != null;
      if (!isSerializedList) fields.description = cleanText(b.description, 500);
    }

    fields.special_instructions = cleanText(b.special_instructions, 300);

    // Nothing the customer would have had to type ⇒ not worth a chip. The
    // pricing/vehicle memory below rides along with real content; on its own
    // it is invisible on this screen and would make the chip a lie.
    const hasContent =
      fields.description != null ||
      (fields.shoppingItems?.length ?? 0) > 0 ||
      fields.shopping_budget != null ||
      fields.special_instructions != null;
    if (!hasContent) continue;

    const vehicle = b.vehicle_type_rate as VehicleKey | null;
    if (vehicle && allowedVehicles.includes(vehicle)) {
      fields.vehicle_type_rate = vehicle;
    }
    if (b.pricing_mode === 'fixed' || b.pricing_mode === 'negotiate') {
      fields.pricing_mode = b.pricing_mode;
      if (b.pricing_mode === 'negotiate') {
        const offer = cleanAmount(b.customer_offer);
        const floor = options.minNegotiateFee;
        if (offer != null && floor != null && offer >= floor) {
          fields.customer_offer = offer;
        }
      }
    }

    return {
      sourceId: b.id,
      sourceCreatedAt: b.created_at,
      typeName: b.errand_type?.name?.trim() || 'errand',
      fields,
      preview: buildPreview(fields, requiresShoppingBudget),
    };
  }

  return null;
}

/**
 * True when the draft already carries content a recall would overwrite.
 * The chip suppresses itself on this so it can never clobber typing in
 * progress (or a "Repeat last" clone the customer arrived with).
 */
export function draftHasRecallableContent(draft: {
  description?: string;
  shoppingItems?: ChecklistItem[];
  shopping_budget?: number;
  special_instructions?: string;
}): boolean {
  if ((draft.description ?? '').trim()) return true;
  if ((draft.shoppingItems ?? []).some((it) => (it?.name ?? '').trim())) return true;
  if (draft.shopping_budget != null) return true;
  if ((draft.special_instructions ?? '').trim()) return true;
  return false;
}

/**
 * The customer's own recurring special-instruction notes, newest first.
 *
 * Deduped case-insensitively against each other AND against the static
 * template chips, so "Call on arrival" never appears twice. Not scoped by
 * errand type: a gate note is about the address, not the service.
 */
export function recentInstructionSuggestions(
  bookings: Booking[] | null | undefined,
  exclude: string[] = [],
  limit = 3,
): string[] {
  if (!Array.isArray(bookings) || bookings.length === 0) return [];
  const seen = new Set(exclude.map((s) => s.trim().toLowerCase()));
  const out: string[] = [];
  for (const b of bookings) {
    if (out.length >= limit) break;
    const note = cleanText(b?.special_instructions, 300);
    if (!note) continue;
    const key = note.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(note);
  }
  return out;
}

/** A (weekday, hour) slot the customer has scheduled into more than once. */
export interface RecurringSlot {
  /** 0 = Sunday … 6 = Saturday (device-local). */
  weekday: number;
  /** 0-23, device-local. */
  hour: number;
  /** Number of DISTINCT past days that landed in this slot. */
  hits: number;
}

/** Local YYYY-MM-DD, so two bookings on the same Saturday count once. */
function localDay(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Find the customer's own recurring scheduling slot, or null.
 *
 * Buckets past `scheduled_at` values by (weekday, hour) in device-local time
 * and returns the busiest bucket that has at least `minHits` DISTINCT days in
 * it. The distinct-day rule is what stops two bookings made for the same
 * Saturday morning from reading as a weekly habit.
 *
 * Self-suppressing by design: below the threshold this returns null rather
 * than guess, because a wrong "your usual slot" is worse than no chip.
 */
export function findRecurringSlot(
  bookings: Booking[] | null | undefined,
  minHits = 2,
): RecurringSlot | null {
  if (!Array.isArray(bookings) || bookings.length === 0) return null;
  const buckets = new Map<string, { weekday: number; hour: number; days: Set<string> }>();

  for (const b of bookings) {
    const iso = b?.scheduled_at;
    if (!iso) continue;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const weekday = d.getDay();
    const hour = d.getHours();
    const key = `${weekday}-${hour}`;
    const bucket = buckets.get(key) ?? { weekday, hour, days: new Set<string>() };
    bucket.days.add(localDay(d));
    buckets.set(key, bucket);
  }

  let best: RecurringSlot | null = null;
  for (const bucket of buckets.values()) {
    const hits = bucket.days.size;
    if (hits < minHits) continue;
    if (!best || hits > best.hits) {
      best = { weekday: bucket.weekday, hour: bucket.hour, hits };
    }
  }
  return best;
}

/**
 * The next wall-clock occurrence of `slot` strictly after `now`, on the hour.
 *
 * Today counts when the hour has not passed yet, so a Saturday-9AM habit
 * offers TODAY at 9 when it is Saturday 7am — not next week.
 */
export function nextOccurrence(slot: RecurringSlot, now: Date): Date {
  const candidate = new Date(now.getTime());
  candidate.setDate(candidate.getDate() + ((slot.weekday - now.getDay() + 7) % 7));
  candidate.setHours(slot.hour, 0, 0, 0);
  // Same weekday but the hour has already gone by ⇒ next week. (Date fields
  // are set AFTER the day shift so the wall-clock hour is what lands, not a
  // pre-shift hour carried across a day boundary.)
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 7);
    candidate.setHours(slot.hour, 0, 0, 0);
  }
  return candidate;
}
