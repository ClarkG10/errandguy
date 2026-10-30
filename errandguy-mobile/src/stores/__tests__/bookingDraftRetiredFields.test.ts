import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBookingStore } from '../bookingStore';

/**
 * Promo codes, "name your price", cards and saved payment methods are retired,
 * but a phone that updates over the air can still hold a half-finished booking
 * draft saved by a build that had them — with a `promo_code` and its saved peso
 * `promo_discount`, a `pricing_mode: 'negotiate'` and the customer's
 * `customer_offer`, or a `payment_method_id` naming a card or a saved account.
 * That draft is still the customer's work, so it must come back intact, minus
 * those fields: nothing reads them now, and leaving them in would re-persist
 * them on every edit for anything that spreads the draft into a request to
 * re-send.
 */
const KEY = '@booking_draft_v1';

const relaunch = async () => {
  useBookingStore.setState({
    draftBooking: {},
    currentStep: 0,
    isDraftHydrated: false,
    createKey: null,
    createKeySig: null,
  });
  await useBookingStore.getState().loadDraftFromStorage();
};

const saveLegacyEnvelope = (draft: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  AsyncStorage.setItem(KEY, JSON.stringify({ draft, step: 3, savedAt: Date.now(), ...extra }));

beforeEach(async () => {
  await AsyncStorage.clear();
  useBookingStore.setState({
    draftBooking: {},
    currentStep: 0,
    isDraftHydrated: false,
    createKey: null,
    createKeySig: null,
  });
});

describe('a booking draft saved by the promo-code build', () => {
  it('restores everything except the promo fields', async () => {
    await saveLegacyEnvelope(
      {
        errand_type_id: 'type-1',
        pickup_address: 'A',
        pickup_lat: 14.6,
        pickup_lng: 121.0,
        payment_method_id: '__gcash__',
        promo_code: 'SAVE10',
        promo_discount: 25,
      },
      { createKey: 'key-1', createKeySig: 'sig-1' },
    );

    await relaunch();

    const s = useBookingStore.getState();
    expect(s.isDraftHydrated).toBe(true);
    expect(s.draftBooking).toEqual({
      errand_type_id: 'type-1',
      pickup_address: 'A',
      pickup_lat: 14.6,
      pickup_lng: 121.0,
      payment_method: 'gcash',
    });
    expect(s.currentStep).toBe(3);
    // The create key is untouched: idempotency still compares the payload
    // signature, so it simply stops matching the promo-free body.
    expect(s.createKey).toBe('key-1');
    expect(s.createKeySig).toBe('sig-1');
  });

  it('does not write the promo fields back on the next edit', async () => {
    await saveLegacyEnvelope({ pickup_address: 'A', promo_code: 'SAVE10', promo_discount: 25 });
    await relaunch();

    useBookingStore.getState().updateDraft({ special_instructions: 'Gate 2' });
    // Past the 250ms persist debounce.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const stored = JSON.parse((await AsyncStorage.getItem(KEY)) as string);
    expect(stored.draft).toEqual({ pickup_address: 'A', special_instructions: 'Gate 2' });
  });

  it('comes back empty when a promo code was all it held', async () => {
    // The old Promos screen's "Use offer" seeded a draft with nothing but the
    // code before the customer picked an errand type.
    await saveLegacyEnvelope({ promo_code: 'SAVE10' }, { step: 0 });

    await relaunch();

    expect(useBookingStore.getState().draftBooking).toEqual({});
  });
});

describe('a booking draft saved by the name-your-price build', () => {
  it('restores an offer draft as a fixed-price draft, keeping the vehicle and the rest', async () => {
    await saveLegacyEnvelope(
      {
        errand_type_id: 'type-1',
        errand_type_slug: 'delivery',
        pickup_address: 'A',
        dropoff_address: 'B',
        vehicle_type_rate: 'car',
        payment_method_id: '__cash__',
        pricing_mode: 'negotiate',
        customer_offer: 150,
        offered_price: 150,
      },
      { createKey: 'key-1', createKeySig: 'sig-1' },
    );

    await relaunch();

    const s = useBookingStore.getState();
    expect(s.isDraftHydrated).toBe(true);
    // The vehicle survives — it is what prices the fixed fare on Review.
    expect(s.draftBooking).toEqual({
      errand_type_id: 'type-1',
      errand_type_slug: 'delivery',
      pickup_address: 'A',
      dropoff_address: 'B',
      vehicle_type_rate: 'car',
      payment_method: 'cash',
    });
    expect(s.currentStep).toBe(3);
    // Untouched: the payload signature simply stops matching the offer-free
    // body, so the next Confirm mints a fresh key for the fixed-price request.
    expect(s.createKey).toBe('key-1');
  });

  it('drops a plain fixed-mode marker too — nothing sends pricing_mode any more', async () => {
    await saveLegacyEnvelope({ pickup_address: 'A', pricing_mode: 'fixed' });

    await relaunch();

    expect(useBookingStore.getState().draftBooking).toEqual({ pickup_address: 'A' });
  });

  it('does not write the offer fields back on the next edit', async () => {
    await saveLegacyEnvelope({
      pickup_address: 'A',
      pricing_mode: 'negotiate',
      customer_offer: 150,
    });
    await relaunch();

    useBookingStore.getState().updateDraft({ special_instructions: 'Gate 2' });
    await new Promise((resolve) => setTimeout(resolve, 400));

    const stored = JSON.parse((await AsyncStorage.getItem(KEY)) as string);
    expect(stored.draft).toEqual({ pickup_address: 'A', special_instructions: 'Gate 2' });
  });
});

describe('a booking draft saved by the build with cards and saved payment methods', () => {
  // That build kept the pick as a selector id: a sentinel for one of the
  // universal options, or the id of a saved card / linked e-wallet. Only the
  // GCash, Maya, wallet and cash sentinels still name something payable.
  it.each([
    ['__gcash__', 'gcash'],
    ['__maya__', 'maya'],
    ['__wallet__', 'wallet'],
    ['__cash__', 'cash'],
  ])('carries the %s pick over as payment_method %s', async (legacyId, method) => {
    await saveLegacyEnvelope({ pickup_address: 'A', payment_method_id: legacyId });

    await relaunch();

    expect(useBookingStore.getState().draftBooking).toEqual({
      pickup_address: 'A',
      payment_method: method,
    });
  });

  it.each([
    ['the card option', '__card__'],
    ['a saved card or linked account', '8f14e45f-ceea-467a-9575-9d2b3c1a2b3c'],
    ['a GrabPay option', '__grabpay__'],
    ['an empty id', ''],
  ])('drops %s, so Review picks the default again', async (_label, legacyId) => {
    await saveLegacyEnvelope(
      { errand_type_id: 'type-1', pickup_address: 'A', payment_method_id: legacyId },
      { createKey: 'key-1', createKeySig: 'sig-1' },
    );

    await relaunch();

    const s = useBookingStore.getState();
    expect(s.isDraftHydrated).toBe(true);
    expect(s.draftBooking).toEqual({ errand_type_id: 'type-1', pickup_address: 'A' });
    // The key is untouched; the next Confirm's body differs, so it mints anew.
    expect(s.createKey).toBe('key-1');
  });

  it('never writes payment_method_id back on the next edit', async () => {
    await saveLegacyEnvelope({ pickup_address: 'A', payment_method_id: '__maya__' });
    await relaunch();

    useBookingStore.getState().updateDraft({ special_instructions: 'Gate 2' });
    await new Promise((resolve) => setTimeout(resolve, 400));

    const stored = JSON.parse((await AsyncStorage.getItem(KEY)) as string);
    expect(stored.draft).toEqual({
      pickup_address: 'A',
      payment_method: 'maya',
      special_instructions: 'Gate 2',
    });
  });

  it('keeps a current draft pick and ignores a retired value in its place', async () => {
    await saveLegacyEnvelope({ pickup_address: 'A', payment_method: 'wallet' });
    await relaunch();
    expect(useBookingStore.getState().draftBooking.payment_method).toBe('wallet');

    await saveLegacyEnvelope({ pickup_address: 'A', payment_method: 'card' });
    await relaunch();
    expect(useBookingStore.getState().draftBooking).toEqual({ pickup_address: 'A' });
  });
});
