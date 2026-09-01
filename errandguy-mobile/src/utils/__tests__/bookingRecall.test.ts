/**
 * Per-errand-type "same as last time" recall.
 *
 * The whole point is that recall is scoped to ONE errand type — a grocery
 * list must never leak onto a bills payment — and that a recalled value can
 * only ever be a legal one (a vehicle the type still allows, an offer that
 * clears the live negotiate floor, a budget that is real money).
 */
import {
  draftHasRecallableContent,
  findRecall,
  findRecurringSlot,
  nextOccurrence,
  recentInstructionSuggestions,
} from '../bookingRecall';
import { serializeChecklist } from '../shoppingChecklist';
import type { Booking } from '../../types/booking';

const GROCERY = 'type-grocery';
const BILLS = 'type-bills';

/** Minimal Booking stub — only the fields recall reads are meaningful. */
function booking(over: Partial<Booking> & { id: string }): Booking {
  return {
    errand_type_id: GROCERY,
    status: 'completed',
    created_at: '2026-08-01T02:00:00.000Z',
    description: null,
    special_instructions: null,
    shopping_budget: null,
    shopping_items: [],
    vehicle_type_rate: null,
    pricing_mode: 'fixed',
    customer_offer: null,
    scheduled_at: null,
    ...over,
  } as unknown as Booking;
}

const SHOPPING_OPTS = {
  errandTypeId: GROCERY,
  requiresShoppingBudget: true,
  showDescription: true,
  allowedVehicles: ['walk', 'bicycle', 'motorcycle', 'car'] as const,
};
const TEXT_OPTS = {
  errandTypeId: BILLS,
  requiresShoppingBudget: false,
  showDescription: true,
  allowedVehicles: ['walk', 'bicycle', 'motorcycle', 'car'] as const,
};

describe('findRecall', () => {
  it('returns null with no type, no bookings, or no matching type', () => {
    expect(findRecall([], { ...SHOPPING_OPTS, allowedVehicles: [...SHOPPING_OPTS.allowedVehicles] })).toBeNull();
    expect(
      findRecall([booking({ id: 'b1', description: 'Meralco 123' })], {
        ...TEXT_OPTS,
        allowedVehicles: [...TEXT_OPTS.allowedVehicles],
      }),
    ).toBeNull(); // b1 is a GROCERY booking, the option asks for BILLS
    expect(
      findRecall([booking({ id: 'b1', description: 'x' })], {
        ...TEXT_OPTS,
        errandTypeId: undefined,
        allowedVehicles: [...TEXT_OPTS.allowedVehicles],
      }),
    ).toBeNull();
  });

  it('never crosses errand types — a grocery list cannot fill a bills payment', () => {
    const list = [
      booking({
        id: 'g1',
        errand_type_id: GROCERY,
        created_at: '2026-08-20T02:00:00.000Z',
        shopping_items: [{ id: 'i1', name: 'Milk', qty: 2 }],
        shopping_budget: 1500,
      }),
      booking({
        id: 'p1',
        errand_type_id: BILLS,
        created_at: '2026-08-01T02:00:00.000Z',
        description: 'Meralco · acct 0123456789 · ref 55',
      }),
    ];
    const recalled = findRecall(list, { ...TEXT_OPTS, allowedVehicles: [...TEXT_OPTS.allowedVehicles] });
    expect(recalled?.sourceId).toBe('p1');
    expect(recalled?.fields.description).toBe('Meralco · acct 0123456789 · ref 55');
    expect(recalled?.fields.shoppingItems).toBeUndefined();
  });

  it('takes the newest booking of the type regardless of list order', () => {
    const list = [
      booking({ id: 'old', created_at: '2026-01-01T00:00:00.000Z', shopping_budget: 100, shopping_items: [{ id: 'i', name: 'Rice', qty: 1 }] }),
      booking({ id: 'new', created_at: '2026-08-25T00:00:00.000Z', shopping_budget: 900, shopping_items: [{ id: 'i', name: 'Eggs', qty: 12 }] }),
    ];
    const recalled = findRecall(list, { ...SHOPPING_OPTS, allowedVehicles: [...SHOPPING_OPTS.allowedVehicles] });
    expect(recalled?.sourceId).toBe('new');
    expect(recalled?.fields.shopping_budget).toBe(900);
  });

  it('skips cancelled bookings and any booking with nothing to recall', () => {
    const list = [
      booking({ id: 'cancelled', created_at: '2026-08-28T00:00:00.000Z', status: 'cancelled', shopping_budget: 5000 }),
      booking({ id: 'empty', created_at: '2026-08-27T00:00:00.000Z' }),
      booking({ id: 'real', created_at: '2026-08-26T00:00:00.000Z', shopping_budget: 800, shopping_items: [{ id: 'i', name: 'Eggs', qty: 12 }] }),
    ];
    expect(findRecall(list, { ...SHOPPING_OPTS, allowedVehicles: [...SHOPPING_OPTS.allowedVehicles] })?.sourceId).toBe('real');
  });

  it('recovers a checklist from a legacy serialized description when shopping_items is empty', () => {
    const list = [
      booking({
        id: 'legacy',
        shopping_items: [],
        description: serializeChecklist([
          { id: 'a', name: 'Milk', qty: 2 },
          { id: 'b', name: 'Bread', qty: 1 },
        ]),
        shopping_budget: 1200,
      }),
    ];
    const recalled = findRecall(list, { ...SHOPPING_OPTS, allowedVehicles: [...SHOPPING_OPTS.allowedVehicles] });
    expect(recalled?.fields.shoppingItems?.map((i) => i.name)).toEqual(['Milk', 'Bread']);
    // A shopping type never recalls `description` — Review re-serializes it.
    expect(recalled?.fields.description).toBeUndefined();
    expect(recalled?.preview).toContain('2 items');
    expect(recalled?.preview).toContain('1,200');
  });

  it('drops ticks and blank rows off a recalled checklist', () => {
    const list = [
      booking({
        id: 'ticked',
        shopping_items: [
          { id: 'i1', name: 'Milk', qty: 2, checked: true, checked_at: '2026-08-01T03:00:00Z' },
          { id: 'i2', name: '   ', qty: 1 },
        ],
        shopping_budget: 500,
      }),
    ];
    const items = findRecall(list, { ...SHOPPING_OPTS, allowedVehicles: [...SHOPPING_OPTS.allowedVehicles] })!.fields.shoppingItems!;
    expect(items).toEqual([{ id: 'i1', name: 'Milk', qty: 2 }]);
  });

  it('never puts a serialized checklist into a free-text description field', () => {
    const list = [
      booking({
        id: 'weird',
        errand_type_id: BILLS,
        description: serializeChecklist([{ id: 'a', name: 'Milk', qty: 1 }]),
      }),
    ];
    expect(findRecall(list, { ...TEXT_OPTS, allowedVehicles: [...TEXT_OPTS.allowedVehicles] })).toBeNull();
  });

  it('drops a zero / negative budget rather than pre-authorising nothing', () => {
    const list = [booking({ id: 'z', shopping_budget: 0, shopping_items: [{ id: 'i', name: 'Milk', qty: 1 }] })];
    expect(findRecall(list, { ...SHOPPING_OPTS, allowedVehicles: [...SHOPPING_OPTS.allowedVehicles] })?.fields.shopping_budget).toBeUndefined();
  });

  it('only recalls a vehicle the current type still allows', () => {
    const list = [booking({ id: 'v', vehicle_type_rate: 'car', description: null, shopping_budget: 400, shopping_items: [{ id: 'i', name: 'Milk', qty: 1 }] })];
    expect(
      findRecall(list, { ...SHOPPING_OPTS, allowedVehicles: ['car', 'motorcycle'] })?.fields.vehicle_type_rate,
    ).toBe('car');
    expect(
      findRecall(list, { ...SHOPPING_OPTS, allowedVehicles: ['walk'] })?.fields.vehicle_type_rate,
    ).toBeUndefined();
  });

  it('recalls a negotiate offer only when it clears the live minimum', () => {
    const list = [
      booking({
        id: 'n',
        pricing_mode: 'negotiate',
        customer_offer: 150,
        shopping_budget: 400,
        shopping_items: [{ id: 'i', name: 'Milk', qty: 1 }],
      }),
    ];
    const base = { ...SHOPPING_OPTS, allowedVehicles: [...SHOPPING_OPTS.allowedVehicles] };
    expect(findRecall(list, { ...base, minNegotiateFee: 90 })?.fields.customer_offer).toBe(150);
    // Floor moved above the remembered offer → drop it; Review seeds the floor.
    expect(findRecall(list, { ...base, minNegotiateFee: 200 })?.fields.customer_offer).toBeUndefined();
    // Floor unknown (estimate not back yet) → never guess.
    expect(findRecall(list, base)?.fields.customer_offer).toBeUndefined();
    // The MODE is still remembered in every case.
    expect(findRecall(list, base)?.fields.pricing_mode).toBe('negotiate');
  });

  it('names the price-moving recalls in the preview — they are only visible on Review', () => {
    const list = [
      booking({
        id: 'n',
        vehicle_type_rate: 'car',
        pricing_mode: 'negotiate',
        customer_offer: 150,
        shopping_budget: 400,
        shopping_items: [{ id: 'i', name: 'Milk', qty: 1 }],
      }),
    ];
    const base = { ...SHOPPING_OPTS, allowedVehicles: [...SHOPPING_OPTS.allowedVehicles] };
    expect(findRecall(list, { ...base, minNegotiateFee: 90 })!.preview).toBe(
      '1 item · budget ₱400.00 · Car · your offer ₱150.00',
    );
    // Offer dropped (under the floor) — the MODE is still disclosed.
    expect(findRecall(list, { ...base, minNegotiateFee: 500 })!.preview).toBe(
      '1 item · budget ₱400.00 · Car · make an offer',
    );
  });

  it('leaves the standing "fixed" default out of the preview as noise', () => {
    const list = [booking({ id: 'f', pricing_mode: 'fixed', shopping_budget: 400, shopping_items: [{ id: 'i', name: 'Milk', qty: 1 }] })];
    expect(findRecall(list, { ...SHOPPING_OPTS, allowedVehicles: [...SHOPPING_OPTS.allowedVehicles] })!.preview).toBe(
      '1 item · budget ₱400.00',
    );
  });

  it('carries the type name and source date for the chip', () => {
    const list = [
      booking({
        id: 'x',
        created_at: '2026-08-20T02:00:00.000Z',
        shopping_budget: 400,
        shopping_items: [{ id: 'i', name: 'Milk', qty: 1 }],
        errand_type: { name: 'Grocery Run' } as never,
      }),
    ];
    const recalled = findRecall(list, { ...SHOPPING_OPTS, allowedVehicles: [...SHOPPING_OPTS.allowedVehicles] })!;
    expect(recalled.typeName).toBe('Grocery Run');
    expect(recalled.sourceCreatedAt).toBe('2026-08-20T02:00:00.000Z');
  });
});

describe('draftHasRecallableContent', () => {
  it('is false for an untouched draft', () => {
    expect(draftHasRecallableContent({})).toBe(false);
    expect(draftHasRecallableContent({ description: '   ' })).toBe(false);
    expect(draftHasRecallableContent({ shoppingItems: [{ id: 'a', name: '  ', qty: 1 }] })).toBe(false);
  });

  it('is true the moment the customer has typed anything recall would overwrite', () => {
    expect(draftHasRecallableContent({ description: 'Meralco' })).toBe(true);
    expect(draftHasRecallableContent({ shoppingItems: [{ id: 'a', name: 'Milk', qty: 1 }] })).toBe(true);
    expect(draftHasRecallableContent({ shopping_budget: 500 })).toBe(true);
    expect(draftHasRecallableContent({ special_instructions: 'Ring twice' })).toBe(true);
  });
});

describe('recentInstructionSuggestions', () => {
  const STATIC = ['Leave at the gate', 'Call on arrival'];

  it('offers the customer own notes newest-first, deduped against the templates', () => {
    const list = [
      booking({ id: '1', special_instructions: 'Unit 12B Tower 2, ring twice' }),
      booking({ id: '2', special_instructions: 'call on ARRIVAL' }),
      booking({ id: '3', special_instructions: '  Unit 12B Tower 2, ring twice  ' }),
      booking({ id: '4', special_instructions: 'Dog is friendly' }),
      booking({ id: '5', special_instructions: 'Blue gate at the corner' }),
    ];
    expect(recentInstructionSuggestions(list, STATIC)).toEqual([
      'Unit 12B Tower 2, ring twice',
      'Dog is friendly',
      'Blue gate at the corner',
    ]);
  });

  it('returns nothing when there are no notes', () => {
    expect(recentInstructionSuggestions([booking({ id: '1' })], STATIC)).toEqual([]);
    expect(recentInstructionSuggestions(null, STATIC)).toEqual([]);
  });
});

describe('findRecurringSlot / nextOccurrence', () => {
  // 2026-08-01 is a Saturday. Local times are what the customer sees.
  const sat9 = (day: number) => new Date(2026, 7, day, 9, 0, 0).toISOString();

  it('self-suppresses below two DISTINCT days', () => {
    expect(findRecurringSlot([booking({ id: '1', scheduled_at: sat9(1) })])).toBeNull();
    // Two bookings for the SAME Saturday morning is not a weekly habit.
    expect(
      findRecurringSlot([
        booking({ id: '1', scheduled_at: sat9(1) }),
        booking({ id: '2', scheduled_at: sat9(1) }),
      ]),
    ).toBeNull();
  });

  it('finds the busiest weekday+hour bucket', () => {
    const slot = findRecurringSlot([
      booking({ id: '1', scheduled_at: sat9(1) }),
      booking({ id: '2', scheduled_at: sat9(8) }),
      booking({ id: '3', scheduled_at: sat9(15) }),
      booking({ id: '4', scheduled_at: new Date(2026, 7, 5, 18, 0, 0).toISOString() }),
    ]);
    expect(slot).toEqual({ weekday: 6, hour: 9, hits: 3 });
  });

  it('ignores unscheduled and unparseable values', () => {
    expect(
      findRecurringSlot([
        booking({ id: '1', scheduled_at: null }),
        booking({ id: '2', scheduled_at: 'not-a-date' }),
      ]),
    ).toBeNull();
  });

  it('offers today when the hour has not passed, next week when it has', () => {
    const slot = { weekday: 6, hour: 9, hits: 3 };
    // Saturday 2026-08-01 at 07:00 local → today at 09:00.
    const early = nextOccurrence(slot, new Date(2026, 7, 1, 7, 0, 0));
    expect(early.getDay()).toBe(6);
    expect(early.getDate()).toBe(1);
    expect(early.getHours()).toBe(9);
    // Saturday at 10:00 → the following Saturday.
    const late = nextOccurrence(slot, new Date(2026, 7, 1, 10, 0, 0));
    expect(late.getDate()).toBe(8);
    expect(late.getHours()).toBe(9);
    // Wednesday → the coming Saturday.
    const mid = nextOccurrence(slot, new Date(2026, 7, 5, 10, 0, 0));
    expect(mid.getDate()).toBe(8);
  });
});
